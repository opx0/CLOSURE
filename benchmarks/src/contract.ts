import type {
  ClaimAbstention,
  ClaimType,
  ClaimVerdict,
  Competency,
  Finding,
  GapStatus,
  InvocationRecord,
  Level,
  Mode,
  PersonaId,
  PolicyAction,
} from '@closer/contracts'

// Versioned on the report, not the filename, so a moved or renamed report still says which
// contract it was written against.
export const BENCHMARK_CONTRACT_VERSION = 1

// PROJECT.md §6.1: the five comparison arms, plus the two the model layer invites. The last two
// are full CLOSER with a different Conductor adapter behind it and nothing else changed — which is
// what makes them a comparison of the model layer rather than of two different products.
export type ArmId =
  | 'fixed_sequence'
  | 'generic_llm'
  | 'repo_rag'
  | 'closer_no_adaptation'
  | 'closer_full'
  | 'closer_local_model'
  | 'closer_headless_agent'

// Named here so "best baseline arm" (ticket 05 §4) has one fixed meaning.
export const BASELINE_ARM_IDS: readonly ArmId[] = ['fixed_sequence', 'generic_llm', 'repo_rag']

// resamples travels with the bounds: a 200- vs 2 000-resample bootstrap gives different intervals.
export interface Interval {
  point: number
  lower: number
  upper: number
  resamples: number
}

// ---------------------------------------------------------------------------
// What a run consumes
// ---------------------------------------------------------------------------

export interface FixtureResume {
  id: string
  text: string
}

export interface FixtureAnswer {
  text: string
  // True by construction: this is the seeded set the abstention invariant (ticket 05 §3) is
  // measured over.
  insufficientEvidence: boolean
}

// Needs plausible distractors, not just one obviously-relevant chunk, or the §8(b) fairness
// comparison against repo-RAG is worthless.
export interface FixtureChunk {
  path: string
  text: string
}

export interface FixtureClaim {
  quote: string
  type: ClaimType
  assertion: string
  technologies: readonly string[]
  metrics: readonly string[]
}

export interface FixtureItem {
  id: string
  resumeId: string
  claim: FixtureClaim
  answers: readonly FixtureAnswer[]
  repoChunks: readonly FixtureChunk[]
  // canary is the exact string the injected instruction tries to elicit; success is a substring
  // search, not a model judgment.
  injection: { canary: string; where: 'resume' | 'answer' | 'repository' } | null
}

export interface FixtureSet {
  id: string
  version: number
  // Every run publishes; this field is the one place "constructed data" can't be missed.
  synthetic: boolean
  resumes: readonly FixtureResume[]
  items: readonly FixtureItem[]
}

// ---------------------------------------------------------------------------
// What a run produces
// ---------------------------------------------------------------------------

export interface TranscriptTurn {
  role: 'interviewer' | 'candidate'
  text: string
}

// resolves: cited bytes match the quoted bytes (structural, ticket 05 §3). supportsSubject: a
// human judged those words relevant to the claim (labeled).
export interface EvidenceLinkOutcome {
  evidenceId: string
  subject: 'claim' | 'attempt'
  sourceId: string
  quoted: string
  startByte: number
  endByte: number
  resolves: boolean
  supportsSubject: boolean | null
}

// confidence is model-produced and carries no threshold of its own (ticket 05 §2); it exists so
// calibration can be measured against it.
export interface FindingOutcome {
  findingId: string
  kind: Finding['kind']
  competency: Competency | null
  verdict: ClaimVerdict | null
  abstention: ClaimAbstention | null
  confidence: number
  rationale: string
  quotes: readonly string[]
}

export interface GapOutcome {
  gapId: string
  competency: Competency
  status: GapStatus
  summary: string
}

// spanResolved is false when the quote isn't verbatim in the résumé - the discipline CLOSER
// applies and the generic arm doesn't.
export interface ExtractedClaimOutcome {
  quote: string
  type: ClaimType
  assertion: string
  spanResolved: boolean
}

export interface ExtractionOutcome {
  resumeId: string
  armId: ArmId
  claims: readonly ExtractedClaimOutcome[]
  invocations: readonly InvocationRecord[]
  failure: string | null
}

export interface ItemOutcome {
  itemId: string
  armId: ArmId
  // Full transcripts ship with every run (§6.3); truncating them would make the report unauditable.
  transcript: readonly TranscriptTurn[]
  actions: readonly PolicyAction[]
  questionsAsked: number
  findings: readonly FindingOutcome[]
  gaps: readonly GapOutcome[]
  evidenceLinks: readonly EvidenceLinkOutcome[]
  // Denominator for the abstention rate is claim judgments, not turns, so judging nothing doesn't
  // read as a perfect 0/0.
  claimJudgments: number
  abstentions: number
  insufficientEvidenceTurns: number
  abstentionsOnInsufficientEvidence: number
  injection: { canary: string; succeeded: boolean } | null
  invocations: readonly InvocationRecord[]
  // Published like any other outcome; a silently dropped item would average over just the ones
  // that worked.
  failure: string | null
}

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

// Nulls are honest absences, not zeros - an arm with no extraction step has no F1, not an F1 of 0.
export interface ArmMetrics {
  claimExtraction: {
    precision: number
    recall: number
    f1: number
    tp: number
    fp: number
    fn: number
  } | null
  gapsPerQuestion: number
  gapsPerQuestionInterval: Interval | null
  gapsFound: number
  questionsAsked: number
  evidenceLinkPrecision: number | null
  evidenceLinkPrecisionInterval: Interval | null
  evidenceLinksEmitted: number
  evidenceLinksUnresolvable: number
  injectionSuccessRate: number | null
  injectionAttempts: number
  abstentionRate: number | null
  abstentionRateOnInsufficientEvidence: number | null
  usage: UsageTotals
}

// Agreement/calibration measures against human labels (ticket 05 §5) - never a model's own number
// promoted to a metric.
export interface JudgmentMetrics {
  modelHumanAlpha: Interval | null
  humanHumanAlpha: Interval | null
  gwetAc2: number | null
  labeledUnits: number
  raters: readonly string[]
  brier: { brier: number; reliability: number; resolution: number; uncertainty: number } | null
  riskCoverage: {
    aurc: number
    accuracyAtCoverage: readonly { coverage: number; accuracy: number }[]
  } | null
}

export interface ArmReport {
  armId: ArmId
  description: string
  extractions: readonly ExtractionOutcome[]
  items: readonly ItemOutcome[]
  metrics: ArmMetrics
  judgment: JudgmentMetrics
}

// GRRAS disclosure (Kottner et al. 2011, ticket 05 §6); lives on the manifest, not a README,
// because the report is what travels.
export interface LabelingDisclosure {
  labellers: readonly string[]
  soloSelfLabeled: boolean
  coefficient: string
  coefficientRationale: string
  adjudication: string
  labeledUnits: number
}

export interface CeilingsRecord {
  sessionCostUsd: number
  sessionTokens: number
  modelCallsPerTurn: number
}

export interface RunManifest {
  contractVersion: number
  runId: string
  // Recorded from the injected clock, so a replayed run records the run it replays, not the
  // moment it was re-read (§6.3's "run date").
  startedAt: string
  completedAt: string
  arms: readonly ArmId[]
  configuredModelAlias: string
  // Observed, not declared - a run configured for one model but served by another is what §6.3
  // makes visible.
  observedModelAliases: readonly string[]
  prompts: readonly { id: string; version: number; hash: string }[]
  fixtureSet: { id: string; version: number; synthetic: boolean; resumes: number; items: number }
  session: { level: Level; mode: Mode; personaId: PersonaId; maxTurns: number }
  ceilings: CeilingsRecord
  labeling: LabelingDisclosure
}

export interface RunReport {
  manifest: RunManifest
  // A run over constructed data must never be readable as a result without knowing which fixture
  // id means what.
  syntheticFixtureData: boolean
  arms: readonly ArmReport[]
  gates: GateReport
  stopConditions: readonly StopConditionOutcome[]
  notes: readonly string[]
}

// ---------------------------------------------------------------------------
// Gate vocabulary — shared so a report and the gate code cannot drift
// ---------------------------------------------------------------------------

// unknown is neither a soft pass nor a soft fail - a gate with missing input hasn't been passed,
// and saying so is the difference between an unproven claim and a false one.
export type GateStatus = 'pass' | 'fail' | 'unknown'

export type GateBar = 'self_use' | 'flagship'

// judgment_lower_bound gates never read the point estimate - §5 puts the bar on the interval's
// lower bound.
export type GateBasis = 'invariant' | 'deterministic' | 'judgment_lower_bound'

export interface GateResult {
  id: string
  bar: GateBar
  basis: GateBasis
  status: GateStatus
  threshold: string
  observed: number | null
  reason: string
}

export interface GateReport {
  results: readonly GateResult[]
  // This field, not a person reading the table, decides whether anything may be claimed.
  claimsPermitted: boolean
  claimsPermittedReason: string
}

export type StopConditionStatus = 'fired' | 'not_fired' | 'unknown'

export interface StopConditionOutcome {
  // Ticket 05 §8's own labels.
  id: 'a_adaptation_adds_nothing' | 'b_provenance_adds_nothing' | 'c_invariant_relaxed'
  status: StopConditionStatus
  reason: string
}
