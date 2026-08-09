import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClaimVerdict } from '@closer/contracts'
import type {
  ArmId,
  ArmMetrics,
  ArmReport,
  ExtractionOutcome,
  Interval,
  ItemOutcome,
  JudgmentMetrics,
  RunManifest,
  RunReport,
  GateBar,
} from './contract.ts'
import { BASELINE_ARM_IDS, BENCHMARK_CONTRACT_VERSION, type FixtureSet } from './contract.ts'
import type { Arm, ArmContext } from './arms/arm.ts'
import {
  abstentionRate,
  annotateEvidenceSupport,
  calibrationItems,
  claimExtractionF1,
  evidenceLinkPrecision,
  gapsPerQuestion,
  injectionSuccessRate,
  usageTotals,
} from './metrics.ts'
import {
  agreementAssertability,
  humanRatingsMatrix,
  labelingDisclosure,
  withModelRater,
  type LabelIndex,
  type RatingsMatrix,
} from './labels.ts'
import { evaluateGates, stopConditions, type GateInput, type InvariantStatus } from './gates.ts'
import {
  FIXED_COVERAGE_LEVELS,
  accuracyAtCoverage,
  bootstrapCiOf,
  brierDecomposed,
  gwetAc2,
  krippendorffOrdinalAlpha,
  riskCoverage,
} from './stats/index.ts'

// Ticket 05 section 5: percentile bootstrap, 2 000 resamples, and no Wald interval at this n.
export const RESAMPLES = 2000
export const ALPHA = 0.05

export interface RunInput {
  fixtures: FixtureSet
  labels: LabelIndex
  arms: readonly Arm[]
  context: ArmContext
  outDir: string
  runId: string
  configuredModelAlias: string
  bar: GateBar
  armUnderTest?: ArmId
  // An empty list makes the invariant gate and stop condition (c) `unknown`, correctly - nothing
  // was checked.
  invariants: readonly InvariantStatus[]
  seed: number
  repeatedRunVariance: number | null
}

export interface RunOutput {
  report: RunReport
  reportPath: string
}

function interval(
  items: readonly ItemOutcome[],
  statistic: (sample: readonly ItemOutcome[]) => number,
  seed: number,
): Interval | null {
  if (items.length === 0) return null
  const computed = bootstrapCiOf(items, statistic, { resamples: RESAMPLES, alpha: ALPHA, seed })
  return Number.isFinite(computed.point) ? computed : null
}

function metricsFor(
  items: readonly ItemOutcome[],
  extractions: readonly ExtractionOutcome[],
  goldClaimsFor: (resumeId: string) => ReturnType<LabelIndex['goldClaims']>,
  seed: number,
): ArmMetrics {
  const gaps = gapsPerQuestion(items)
  const evidence = evidenceLinkPrecision(items)
  const injection = injectionSuccessRate(items)
  const abstention = abstentionRate(items)

  // Null, not zero, when the arm has no extraction step - a gate reading a fabricated zero would
  // report a failure that is really an absence.
  const predicted = extractions.flatMap((one) => one.claims)
  const gold = extractions.flatMap((one) => goldClaimsFor(one.resumeId))
  const extraction = extractions.length === 0 ? null : claimExtractionF1(predicted, gold)

  return {
    claimExtraction: extraction,
    gapsPerQuestion: gaps.ratio,
    // Resampled over items, not questions - the item is the independent unit.
    gapsPerQuestionInterval: interval(items, (sample) => gapsPerQuestion(sample).ratio, seed),
    gapsFound: gaps.gaps,
    questionsAsked: gaps.questions,
    evidenceLinkPrecision: evidence.precision,
    evidenceLinkPrecisionInterval:
      evidence.precision === null
        ? null
        : interval(items, (sample) => evidenceLinkPrecision(sample).precision ?? NaN, seed + 1),
    evidenceLinksEmitted: evidence.emitted,
    evidenceLinksUnresolvable: evidence.unresolvable,
    injectionSuccessRate: injection.rate,
    injectionAttempts: injection.attempts,
    abstentionRate: abstention.rate,
    abstentionRateOnInsufficientEvidence: abstention.onInsufficientEvidence,
    usage: usageTotals(items, extractions),
  }
}

function verdictOf(items: readonly ItemOutcome[]): (itemId: string) => ClaimVerdict | null {
  const byItem = new Map<string, ClaimVerdict>()
  for (const item of items) {
    const judged = item.findings.find((finding) => finding.verdict !== null)
    if (judged?.verdict != null && !byItem.has(item.itemId)) byItem.set(item.itemId, judged.verdict)
  }
  return (itemId) => byItem.get(itemId) ?? null
}

function alphaInterval(matrix: RatingsMatrix, seed: number): Interval | null {
  if (matrix.raters.length < 2 || matrix.ratings.length === 0) return null
  const computed = bootstrapCiOf(matrix.ratings, (rows) => krippendorffOrdinalAlpha(rows), {
    resamples: RESAMPLES,
    alpha: ALPHA,
    seed,
  })
  return Number.isFinite(computed.point) ? computed : null
}

// Published as absent, never as zero - a degenerate matrix returning 0.0 would read as total
// disagreement.
function safeAc2(matrix: RatingsMatrix): number | null {
  if (matrix.raters.length < 2) return null
  try {
    const value = gwetAc2(matrix.ratings)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function judgmentFor(
  items: readonly ItemOutcome[],
  labels: LabelIndex,
  humans: RatingsMatrix,
  humanHuman: Interval | null,
  seed: number,
): JudgmentMetrics {
  const paired = calibrationItems(items, (itemId) => labels.adjudicated(itemId))
  const selective = paired.map((one) => ({ confidence: one.confidence, correct: one.correct }))
  const withModel = withModelRater(humans, verdictOf(items))

  const ac2 = safeAc2(withModel)
  const curve = selective.length === 0 ? null : riskCoverage(selective)

  return {
    modelHumanAlpha: alphaInterval(withModel, seed),
    humanHumanAlpha: humanHuman,
    gwetAc2: ac2,
    labeledUnits: humans.units.length,
    raters: withModel.raters,
    brier:
      paired.length === 0
        ? null
        : (() => {
            const decomposed = brierDecomposed(
              paired.map((one) => ({ p: one.confidence, outcome: one.correct ? 1 : 0 }) as const),
            )
            return {
              brier: decomposed.brier,
              reliability: decomposed.reliability,
              resolution: decomposed.resolution,
              uncertainty: decomposed.uncertainty,
            }
          })(),
    riskCoverage:
      curve === null
        ? null
        : {
            aurc: curve.aurc,
            // Read from the stats package rather than restated, so the two files can't drift.
            accuracyAtCoverage: FIXED_COVERAGE_LEVELS.map((coverage) => ({
              coverage,
              accuracy: accuracyAtCoverage(selective, coverage),
            })),
          },
  }
}

async function nextRunDir(outDir: string, runId: string): Promise<string> {
  await mkdir(outDir, { recursive: true })
  for (let attempt = 1; ; attempt += 1) {
    const dir = join(outDir, attempt === 1 ? runId : `${runId}-${attempt}`)
    try {
      // Non-recursive: an existing directory throws instead of being reused, so a re-run is
      // published in addition, never instead.
      await mkdir(dir)
      return dir
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

// Publication is a pipeline stage, not a decision: there is no flag to run the benchmark without
// writing the report, and no branch that inspects the numbers before deciding what to keep.
export async function runBenchmark(input: RunInput): Promise<RunOutput> {
  const startedAt = input.context.clock.now()
  const armUnderTest: ArmId = input.armUnderTest ?? 'closer_full'
  const humans = humanRatingsMatrix(input.labels)
  const humanHuman = alphaInterval(humans, input.seed)

  const reports: ArmReport[] = []
  for (const arm of input.arms) {
    // An arm that names an alternate Conductor runs behind that one or not at all. Falling back to
    // the default would publish the default model's numbers under this arm's name.
    const alternate =
      arm.requiresConductor === undefined
        ? input.context.conductor
        : input.context.alternateConductors?.[arm.requiresConductor]
    const context: ArmContext =
      alternate === undefined ? input.context : { ...input.context, conductor: alternate }
    const unavailable =
      arm.requiresConductor !== undefined && alternate === undefined
        ? `no ${arm.requiresConductor} conductor was configured for this run`
        : null

    const extractions: ExtractionOutcome[] = []
    if (arm.extract !== null) {
      for (const resume of input.fixtures.resumes) {
        extractions.push(
          unavailable === null
            ? await arm.extract(resume, context)
            : {
                resumeId: resume.id,
                armId: arm.id,
                claims: [],
                invocations: [],
                failure: unavailable,
              },
        )
      }
    }

    const items: ItemOutcome[] = []
    for (const item of input.fixtures.items) {
      const resume = input.fixtures.resumes.find((one) => one.id === item.resumeId)
      if (resume === undefined) continue
      if (unavailable !== null) {
        items.push({
          itemId: item.id,
          armId: arm.id,
          transcript: [],
          actions: [],
          questionsAsked: 0,
          findings: [],
          gaps: [],
          evidenceLinks: [],
          claimJudgments: 0,
          abstentions: 0,
          insufficientEvidenceTurns: 0,
          abstentionsOnInsufficientEvidence: 0,
          injection: null,
          invocations: [],
          failure: unavailable,
        })
        continue
      }
      const outcome = await arm.interrogate(item, resume, context)
      // Attached here, outside the arm, so no arm decides whether its own evidence was relevant.
      items.push(annotateEvidenceSupport(outcome, input.labels.supportingQuotes(item.id)))
    }

    reports.push({
      armId: arm.id,
      description: arm.description,
      extractions,
      items,
      metrics: metricsFor(
        items,
        extractions,
        (resumeId) => input.labels.goldClaims(resumeId),
        input.seed,
      ),
      judgment: judgmentFor(items, input.labels, humans, humanHuman, input.seed),
    })
  }

  const under = reports.find((report) => report.armId === armUnderTest)
  const baselines = reports.filter((report) => BASELINE_ARM_IDS.includes(report.armId))
  const summary = (report: ArmReport): { armId: ArmId; metrics: ArmMetrics } => ({
    armId: report.armId,
    metrics: report.metrics,
  })

  const gateInput: GateInput = {
    bar: input.bar,
    syntheticFixtures: input.fixtures.synthetic,
    underTest:
      under === undefined
        ? { armId: armUnderTest, metrics: metricsFor([], [], () => [], input.seed) }
        : summary(under),
    baselines: baselines.map(summary),
    ablation:
      reports.filter((report) => report.armId === 'closer_no_adaptation').map(summary)[0] ?? null,
    repoRag: reports.filter((report) => report.armId === 'repo_rag').map(summary)[0] ?? null,
    agreement: {
      modelHuman: under?.judgment.modelHumanAlpha ?? null,
      humanHuman,
      assertability: agreementAssertability(humans),
    },
    calibration:
      under?.judgment.brier === undefined || under.judgment.brier === null
        ? null
        : {
            reliability: under.judgment.brier.reliability,
            resolution: under.judgment.brier.resolution,
          },
    abstention: {
      aurc: under?.judgment.riskCoverage?.aurc ?? null,
      baselines: baselines.map((report) => ({
        armId: report.armId,
        aurc: report.judgment.riskCoverage?.aurc ?? null,
      })),
    },
    repeatedRunVariance: input.repeatedRunVariance,
    invariants: input.invariants,
    ceilings: {
      sessionCostUsd: input.context.ceilings.sessionCostUsd,
      sessionTokens: input.context.ceilings.sessionTokens,
      modelCallsPerTurn: input.context.ceilings.modelCallsPerTurn,
    },
  }

  const invocations = reports.flatMap((report) => [
    ...report.items.flatMap((item) => item.invocations),
    ...report.extractions.flatMap((extraction) => extraction.invocations),
  ])
  const prompts = [
    ...new Map(
      invocations.map((one) => [
        `${one.promptId}@${one.promptVersion}#${one.promptHash}`,
        { id: one.promptId, version: one.promptVersion, hash: one.promptHash },
      ]),
    ).values(),
  ]

  const manifest: RunManifest = {
    contractVersion: BENCHMARK_CONTRACT_VERSION,
    runId: input.runId,
    startedAt,
    completedAt: input.context.clock.now(),
    arms: reports.map((report) => report.armId),
    configuredModelAlias: input.configuredModelAlias,
    observedModelAliases: [...new Set(invocations.map((one) => one.modelAlias))].sort(),
    prompts,
    fixtureSet: {
      id: input.fixtures.id,
      version: input.fixtures.version,
      synthetic: input.fixtures.synthetic,
      resumes: input.fixtures.resumes.length,
      items: input.fixtures.items.length,
    },
    session: {
      level: input.context.level,
      mode: input.context.mode,
      personaId: input.context.personaId,
      maxTurns: input.context.maxTurns,
    },
    ceilings: gateInput.ceilings,
    labeling: labelingDisclosure(input.labels),
  }

  const report: RunReport = {
    manifest,
    syntheticFixtureData: input.fixtures.synthetic,
    arms: reports,
    gates: evaluateGates(gateInput),
    stopConditions: stopConditions(gateInput),
    notes: [
      'Ticket 05 section 7: this report was written by the run that produced it. There is no editorial step between running and publishing, and a re-run is published in addition, never instead.',
      ...(input.fixtures.synthetic
        ? [
            'SYNTHETIC FIXTURE DATA. Every number here was produced over constructed inputs with scripted model ports. It is a check of the machinery and is not a result about CLOSER or about any arm.',
          ]
        : []),
    ],
  }

  const dir = await nextRunDir(input.outDir, input.runId)
  const reportPath = join(dir, 'report.json')
  // `wx`: a failed write is a better outcome than a quietly overwritten result.
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  // Append-only ledger of every run this directory has held, written alongside the report.
  await appendFile(
    join(input.outDir, 'runs.jsonl'),
    `${JSON.stringify({
      runId: manifest.runId,
      completedAt: manifest.completedAt,
      fixtureSet: manifest.fixtureSet.id,
      synthetic: report.syntheticFixtureData,
      claimsPermitted: report.gates.claimsPermitted,
      reportPath,
    })}\n`,
  )

  return { report, reportPath }
}
