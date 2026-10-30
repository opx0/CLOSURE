import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { preflightLocalModels } from './preflight.ts'

// Imported observations are explicitly attributed to a person and a shared run configuration.
// This tool checks their completeness and limits; it cannot independently verify human labels.
const Nonnegative = Type.Number({ minimum: 0 })
const Case = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  meaningCriticalErrors: Type.Integer({ minimum: 0 }),
  reviewedBy: Type.String({ minLength: 1, maxLength: 120 }),
})
const Observation = Type.Object(
  {
    candidateId: Type.String({ minLength: 1 }),
    loadedArtifactDigestsVerifiedBy: Type.String({ minLength: 1 }),
    measuredAt: Type.String({ minLength: 1 }),
    reviewer: Type.String({ minLength: 1 }),
    configuration: Type.String({ minLength: 1, maxLength: 2000 }),
    cases: Type.Array(Case, { minItems: 1, maxItems: 100 }),
    metrics: Type.Object(
      {
        asrLagP95Ms: Nonnegative,
        coldFirstTokenMs: Nonnegative,
        warmFirstTokenMs: Nonnegative,
        firstAudioMs: Nonnegative,
        peakRamBytes: Nonnegative,
        peakVramBytes: Nonnegative,
        peakCpuPercent: Nonnegative,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)
const Input = Type.Object(
  {
    version: Type.Literal(1),
    kind: Type.Union([
      Type.Literal('streaming_asr'),
      Type.Literal('batch_asr'),
      Type.Literal('llm'),
    ]),
    casesSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    limits: Type.Object(
      {
        meaningCriticalErrors: Type.Integer({ minimum: 0 }),
        asrLagP95Ms: Nonnegative,
        coldFirstTokenMs: Nonnegative,
        warmFirstTokenMs: Nonnegative,
        firstAudioMs: Nonnegative,
        peakRamBytes: Nonnegative,
        peakVramBytes: Nonnegative,
        peakCpuPercent: Nonnegative,
      },
      { additionalProperties: false },
    ),
    observations: Type.Array(Observation, { minItems: 1, maxItems: 3 }),
  },
  { additionalProperties: false },
)

const [manifestPath, casesPath, observationsPath, reportPath] = process.argv.slice(2)
if (!manifestPath || !casesPath || !observationsPath || !reportPath || process.argv.length !== 6)
  throw new Error(
    'Usage: bun run models:select CANDIDATES.json CASES.json OBSERVATIONS.json NEW_REPORT.json',
  )
const preflight = await preflightLocalModels(JSON.parse(await readFile(manifestPath, 'utf8')))
const caseBytes = await readFile(casesPath)
const caseData: unknown = JSON.parse(caseBytes.toString('utf8'))
if (
  !Array.isArray(caseData) ||
  caseData.length < 1 ||
  caseData.length > 100 ||
  caseData.some((item) => !item || typeof item.id !== 'string' || !item.id.trim()) ||
  new Set(caseData.map((item) => item.id)).size !== caseData.length
)
  throw new Error('Cases must contain 1–100 distinct case IDs')
const value: unknown = JSON.parse(await readFile(observationsPath, 'utf8'))
if (!Value.Check(Input, value)) throw new Error('Invalid model measurements or limits')
const data: Static<typeof Input> = value
if (data.casesSha256 !== createHash('sha256').update(caseBytes).digest('hex'))
  throw new Error('Case file digest differs from the recorded comparison')
const expected = caseData.map((item) => item.id).sort()
const ids = data.observations.map((item) => item.candidateId)
if (new Set(ids).size !== ids.length) throw new Error('Duplicate candidate observations')
const unmeasuredCandidates = preflight.candidates
  .filter(
    (candidate) =>
      candidate.kind === data.kind && candidate.artifactReady && !ids.includes(candidate.id),
  )
  .map((candidate) => candidate.id)
const config = data.observations[0]!.configuration.trim()
if (!config || data.observations.some((item) => item.configuration.trim() !== config))
  throw new Error('Candidates must be measured under the same stated configuration')
const results = data.observations.map((observation) => {
  const candidate = preflight.candidates.find((item) => item.id === observation.candidateId)
  if (!candidate || candidate.kind !== data.kind)
    throw new Error('Observation has no matching candidate of the requested kind')
  const actual = observation.cases.map((item) => item.id).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Each candidate must use all the same cases exactly once')
  if (
    !observation.reviewer.trim() ||
    !observation.loadedArtifactDigestsVerifiedBy.trim() ||
    observation.cases.some((item) => !item.reviewedBy.trim()) ||
    !Number.isFinite(Date.parse(observation.measuredAt))
  )
    throw new Error('Reviewers and artifact identity verification must be named')
  const critical = observation.cases.reduce((sum, item) => sum + item.meaningCriticalErrors, 0)
  const measured = { meaningCriticalErrors: critical, ...observation.metrics }
  const failures = Object.entries(data.limits).flatMap(([key, limit]) =>
    measured[key as keyof typeof measured] > limit ? [key] : [],
  )
  if (!candidate.artifactReady) failures.push('artifact_digest')
  return { candidate, observation, measured, failures, feasible: failures.length === 0 }
})
// Fewest meaning-critical errors, then lower warm first-token and ASR lag; stable ID breaks ties.
const feasible = results
  .filter((result) => result.feasible)
  .sort(
    (a, b) =>
      a.measured.meaningCriticalErrors - b.measured.meaningCriticalErrors ||
      a.measured.warmFirstTokenMs - b.measured.warmFirstTokenMs ||
      a.measured.asrLagP95Ms - b.measured.asrLagP95Ms ||
      a.candidate.id.localeCompare(b.candidate.id),
  )
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      version: 1,
      createdAt: new Date().toISOString(),
      casesSha256: data.casesSha256,
      kind: data.kind,
      limits: data.limits,
      configuration: config,
      results,
      unmeasuredCandidates,
      selectedCandidateId:
        unmeasuredCandidates.length === 0 ? (feasible[0]?.candidate.id ?? null) : null,
      disposition: unmeasuredCandidates.length
        ? 'comparison_incomplete'
        : feasible.length
          ? 'provisional_selection'
          : 'no_candidate_meets_limits',
      note: 'Selection uses imported, attributed observations. Confirm measurements, reviewer judgments, loaded artifacts and simultaneous ASR/TTS/retrieval conditions before treating it as validated.',
    },
    null,
    2,
  )}\n`,
  { flag: 'wx', mode: 0o600 },
)
console.log(
  unmeasuredCandidates.length
    ? 'Comparison incomplete; unmeasured candidates listed in report.'
    : feasible.length
      ? `Provisional selection: ${feasible[0]!.candidate.id}`
      : 'No candidate meets all stated limits; failure report saved.',
)
