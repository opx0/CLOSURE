import type {
  AnyEvent,
  Claim,
  Finding,
  Level,
  PolicyAction,
  RoundKind,
  Topic,
} from '@levelhead/contracts'
import type {
  Ceilings,
  ConductorPort,
  EvaluatorPort,
  PinnedContext,
  SessionView,
} from '@levelhead/core'
import { spanViolations } from '@levelhead/core'
import { runSession, type SessionIo, type SessionResult } from '@levelhead/core'
import { FixedClock, MemoryEventStore, SeqIds } from './fakes.ts'

export const HARNESS_CEILINGS: Ceilings = {
  sessionCostUsd: 2,
  sessionTokens: 120_000,
  modelCallsPerTurn: 3,
}

export const DEEP_DIVE: readonly RoundKind[] = ['project_deep_dive']

export type QuestionMeta = Parameters<SessionIo['question']>[1]

export interface RecordedIo extends SessionIo {
  readonly questions: readonly string[]
  readonly asked: readonly { text: string; meta: QuestionMeta }[]
  readonly notices: readonly string[]
  readonly shown: readonly Finding[]
  readonly answered: readonly string[]
}

// The last answer repeats when the script runs out, so extra turns finish deterministically.
export function recordedIo(answers: readonly string[]): RecordedIo {
  const questions: string[] = []
  const asked: { text: string; meta: QuestionMeta }[] = []
  const notices: string[] = []
  const shown: Finding[] = []
  const answered: string[] = []
  const last = answers[answers.length - 1] ?? ''

  return {
    questions,
    asked,
    notices,
    shown,
    answered,
    round() {},
    question(text, meta) {
      questions.push(text)
      asked.push({ text, meta })
    },
    async answer() {
      const next = answers[answered.length] ?? last
      answered.push(next)
      return next
    },
    findings(found) {
      shown.push(...found)
    },
    async confirmRetry() {
      return false
    },
    notice(text) {
      notices.push(text)
    },
  }
}

export interface HarnessSessionInput {
  claims: readonly Claim[]
  answers: readonly string[]
  conductor: ConductorPort
  evaluator: EvaluatorPort
  mode?: Parameters<typeof runSession>[0]['mode']
  level?: Level
  turnsPerRound?: number
  rounds?: readonly RoundKind[]
  topics?: readonly Topic[]
  pinned?: PinnedContext
  drill?: boolean
  transferGap?: Parameters<typeof runSession>[0]['transferGap']
  store?: MemoryEventStore
}

export interface HarnessSession {
  result: SessionResult
  store: MemoryEventStore
  io: RecordedIo
  events: readonly AnyEvent[]
}

// All four non-deterministic inputs injected — store, clock, ids, both model ports — which is the
// precondition every invariant in this directory depends on.
export async function runHarnessSession(input: HarnessSessionInput): Promise<HarnessSession> {
  const store = input.store ?? new MemoryEventStore()
  const io = recordedIo(input.answers)

  const result = await runSession({
    // Confirmation is a separate step tested elsewhere; these harnesses put the claim in play already confirmed.
    claims: input.claims.map((claim) => ({ ...claim, confirmedByCandidate: true })),
    mode: input.mode ?? 'coach',
    level: input.level ?? 'mid',
    personaId: 'skeptic',
    pressureCeiling: 3,
    rounds: [...(input.rounds ?? DEEP_DIVE)],
    ...(input.topics === undefined ? {} : { topics: input.topics }),
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
    turnsPerRound: input.turnsPerRound ?? 1,
    drill: input.drill ?? false,
    ...(input.transferGap === undefined ? {} : { transferGap: input.transferGap }),
    ceilings: HARNESS_CEILINGS,
    deps: {
      store,
      clock: new FixedClock(),
      ids: new SeqIds(),
      conductor: input.conductor,
      evaluator: input.evaluator,
      io,
    },
  })

  return { result, store, io, events: await store.read(result.sessionId) }
}

// Complements the no-aggregate-score source grep: that proves no schema declares this field, this
// proves no runtime payload smuggles one in.
const AGGREGATE_KEY =
  /^(readiness|overall|composite|aggregate|total)_?[Ss]core$|^score(Percent|Pct)$/

// Structural, not textual — a rationale is model prose and may legitimately say "readiness score".
export function aggregateScoreKeys(events: readonly AnyEvent[]): string[] {
  const found: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (AGGREGATE_KEY.test(key)) found.push(`${path}.${key}`)
      walk(child, `${path}.${key}`)
    }
  }
  for (const event of events) walk(event, `${event.seq}:${event.kind}`)
  return found
}

// Every span a finding cites must resolve, to the exact quoted bytes. Returns failures so a test can name them.
export function citationFailures(view: SessionView): string[] {
  const failures = spanViolations(view.spans.values(), view.sources).map(
    (violation) => `${violation.spanId}: ${violation.reason}`,
  )
  for (const finding of view.findings) {
    for (const spanId of finding.transcriptSpanIds) {
      if (!view.spans.has(spanId)) failures.push(`${finding.id} cites missing span ${spanId}`)
    }
    for (const evidenceId of finding.evidenceIds) {
      if (!view.evidence.has(evidenceId)) {
        failures.push(`${finding.id} cites missing evidence ${evidenceId}`)
      }
    }
  }
  return failures
}

export interface ChosenAction {
  attemptId: string
  planned: PolicyAction
  taken: PolicyAction
}

// Pairs each `policy_action` with the `plan` that preceded it — where they agree, no model output
// reached the decision.
export function plannedVersusTaken(events: readonly AnyEvent[]): ChosenAction[] {
  const paired: ChosenAction[] = []
  let planned: PolicyAction | null = null
  for (const event of events) {
    if (event.kind === 'plan') planned = event.payload.chosen
    if (event.kind === 'policy_action' && planned !== null) {
      paired.push({ attemptId: event.payload.attemptId, planned, taken: event.payload.action })
      planned = null
    }
  }
  return paired
}

export function observationNotes(events: readonly AnyEvent[]): string[] {
  return events.flatMap((event) => (event.kind === 'observation' ? [event.payload.note] : []))
}
