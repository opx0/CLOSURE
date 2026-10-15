import { CLAIM_VERDICT_ORDER, type ClaimVerdict } from '@levelhead/contracts'
import { replay } from '@levelhead/core'
import {
  FIXED_COVERAGE_LEVELS,
  LabelIndex,
  accuracyAtCoverage,
  agreementAssertability,
  bootstrapCiOf,
  brierDecomposed,
  gwetAc2,
  humanRatingsMatrix,
  krippendorffOrdinalAlpha,
  tallyErrors,
  labelingDisclosure,
  loadLabels,
  riskCoverage,
  withModelRater,
} from '@levelhead/benchmarks'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'

const DEFAULT_LABELS = 'fixtures/labels/claims.jsonl'
const RESAMPLES = 2_000

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// Computes agreement and calibration from labels that exist. It never fills in a missing label, and
// it prints the interval rather than the point estimate wherever a bar would otherwise be read off
// a number (ticket 05 §5).
export async function calibrate(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)
  const path = flag(argv, 'labels') ?? DEFAULT_LABELS

  try {
    const parsed = await loadLabels(path).catch(() => null)
    if (parsed === null) {
      line(`no label file at ${path} — write one with: levelhead label`)
      return 1
    }
    for (const error of parsed.errors) dim(`  ${path}: ${error}`)

    const index = new LabelIndex(parsed.labels)
    const disclosure = labelingDisclosure(index)

    const modelVerdicts = new Map<string, ClaimVerdict>()
    const abstained = new Set<string>()

    for (const sessionId of await store.listSessions()) {
      const view = replay(await store.read(sessionId))
      for (const finding of view.findings) {
        if (finding.kind === 'claim') modelVerdicts.set(finding.id, finding.verdict)
        if (finding.kind === 'claim_abstained') abstained.add(finding.id)
      }
    }

    const withConfidence: { confidence: number; correct: boolean }[] = []
    for (const sessionId of await store.listSessions()) {
      const view = replay(await store.read(sessionId))
      for (const finding of view.findings) {
        if (finding.kind !== 'claim') continue
        const human = index.adjudicated(finding.id)
        if (human === null) continue
        withConfidence.push({ confidence: finding.confidence, correct: finding.verdict === human })
      }
    }

    const humanMatrix = humanRatingsMatrix(index)
    const modelMatrix = withModelRater(humanMatrix, (itemId) => modelVerdicts.get(itemId) ?? null)
    const assertability = agreementAssertability(humanMatrix)

    heading('labels')
    line(`  ${path}`)
    dim(
      `  ${disclosure.labeledUnits} labelled units · labellers: ${disclosure.labellers.join(', ') || 'none'}`,
    )
    if (disclosure.soloSelfLabeled) {
      dim('  solo self-labelled. GRRAS requires that be disclosed in every report, and it is.')
    }

    heading('agreement')
    if (humanMatrix.units.length < 2) {
      dim('  fewer than two labelled units — alpha is not a quantity here, so none is printed.')
    } else {
      const humanAlpha = bootstrapCiOf(
        humanMatrix.ratings,
        (sample) => krippendorffOrdinalAlpha(sample),
        { seed: 1, resamples: RESAMPLES },
      )
      const modelAlpha = bootstrapCiOf(
        modelMatrix.ratings,
        (sample) => krippendorffOrdinalAlpha(sample),
        { seed: 1, resamples: RESAMPLES },
      )
      line(
        `  human–human alpha  ${humanAlpha.point.toFixed(3)}  [${humanAlpha.lower.toFixed(3)}, ${humanAlpha.upper.toFixed(3)}]`,
      )
      line(
        `  model–human alpha  ${modelAlpha.point.toFixed(3)}  [${modelAlpha.lower.toFixed(3)}, ${modelAlpha.upper.toFixed(3)}]`,
      )
      dim(`  Gwet's AC2         ${gwetAc2(modelMatrix.ratings).toFixed(3)}`)
      dim(`  ${assertability.reason}`)
      dim('  the bar is on the interval’s lower bound, never the point estimate.')
    }

    heading('calibration')
    if (withConfidence.length === 0) {
      dim('  no finding has both a model confidence and an adjudicated human verdict yet.')
    } else {
      const brier = brierDecomposed(
        withConfidence.map((row) => ({
          p: row.confidence,
          outcome: row.correct ? (1 as const) : (0 as const),
        })),
      )
      line(`  Brier            ${brier.brier.toFixed(4)}`)
      dim(
        `  reliability ${brier.reliability.toFixed(4)} · resolution ${brier.resolution.toFixed(4)} · uncertainty ${brier.uncertainty.toFixed(4)}`,
      )
      dim('  ECE is deliberately not reported: it is biased at this n and is not a proper score.')

      const curve = riskCoverage(withConfidence)
      line(`  AURC             ${curve.aurc.toFixed(4)}`)
      // Pre-declared before any run existed, so abstaining on everything hard cannot look accurate.
      for (const coverage of FIXED_COVERAGE_LEVELS) {
        const accuracy = accuracyAtCoverage(withConfidence, coverage)
        dim(
          `  accuracy at fixed coverage ${(coverage * 100).toFixed(0)}%: ${Number.isNaN(accuracy) ? 'not computable at this n' : accuracy.toFixed(3)}`,
        )
      }
    }

    heading('error taxonomy')
    const errors = tallyErrors(index.errorClasses())
    if (errors.length === 0) {
      dim('  no disagreement has been classified yet — label one with kind "error_class".')
    } else {
      for (const tally of errors) {
        line(`  ${String(tally.count).padStart(3)}  ${tally.class}`)
        dim(`       ${tally.meaning}`)
      }
      dim(
        '  counts only. A severity weighting over these would be an aggregate score by another name.',
      )
    }

    heading('abstention')
    line(`  ${abstained.size} findings abstained rather than guessed.`)
    dim('  an evaluator that cannot say "I do not know" will eventually lie to you.')

    line('')
    dim(
      `  ${CLAIM_VERDICT_ORDER.length}-point ordinal scale; the two abstentions are off it by design.`,
    )
    return 0
  } finally {
    await close()
  }
}
