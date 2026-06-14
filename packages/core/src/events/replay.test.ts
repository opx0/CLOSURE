import { expect, test } from 'bun:test'
import {
  EVENT_SCHEMA_VERSION,
  type AnyEvent,
  type Claim,
  type EventKind,
  type EventOf,
  type GapEntry,
  type InvocationRecord,
  type Session,
  type Span,
} from '@closer/contracts'
import { replay, type SessionView } from './replay.ts'
import { assertValidEvent } from './validate.ts'

const SESSION = 'ses_1'
const AT = '2026-09-09T10:00:00.000Z'

function at<K extends EventKind>(seq: number, kind: K, payload: EventOf<K>['payload']): AnyEvent {
  return {
    eventId: `evt_${seq}`,
    sessionId: SESSION,
    seq,
    occurredAt: AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind,
    payload,
  } as AnyEvent
}

function invocation(id: string, port: 'conductor' | 'evaluator'): InvocationRecord {
  return {
    id,
    port,
    modelAlias: 'test-model',
    promptId: 'prompt',
    promptVersion: 1,
    promptHash: 'hash',
    inputTokens: 100,
    outputTokens: 20,
    costUsd: 0.25,
    stopReason: 'end_turn',
    latencyMs: 5,
    occurredAt: AT,
  }
}

const RESUME = 'Built a job queue with Bun'
const session: Session = {
  id: SESSION,
  mode: 'coach',
  level: 'senior',
  personaId: 'skeptic',
  pressureLevel: 0,
  pressureCeiling: 2,
  rubricSet: [{ id: 'claim_status', version: 1 }],
  claimIds: ['clm_1'],
  rounds: ['project_deep_dive'],
  startedAt: AT,
}
const span: Span = {
  id: 'spn_1',
  sourceId: 'src_resume',
  startByte: 0,
  endByte: RESUME.length,
  quoted: RESUME,
}
const claim: Claim = {
  id: 'clm_1',
  spanId: 'spn_1',
  type: 'built',
  assertion: 'Built a job queue with Bun',
  technologies: ['bun'],
  metrics: [],
  implied: false,
  confirmedByCandidate: false,
  extractorVersion: 'extract-1',
}
const gap: GapEntry = {
  id: 'gap_1',
  competency: 'mechanism',
  summary: 'cannot explain at-least-once delivery',
  status: 'open',
  findingIds: ['fnd_1'],
  evidenceIds: ['evd_1'],
  openedAt: AT,
  lastTouchedAt: AT,
  transferAttemptIds: [],
  retrievals: [],
}

const events: AnyEvent[] = [
  at(0, 'state_change', { change: 'session_started', session }),
  at(1, 'state_change', {
    change: 'source_registered',
    sourceId: 'src_resume',
    kind: 'resume',
    text: RESUME,
    contentHash: 'sha256:abc',
  }),
  at(2, 'state_change', {
    change: 'claims_extracted',
    claims: [claim],
    spans: [span],
    invocation: invocation('inv_extract', 'evaluator'),
  }),
  at(3, 'state_change', {
    change: 'claim_confirmed',
    claimId: 'clm_1',
    confirmed: true,
    editedAssertion: 'Built a job queue with Bun and Postgres',
  }),
  at(4, 'state_change', { change: 'session_state', from: 'selecting', to: 'asking' }),
  at(5, 'plan', {
    attemptId: 'att_1',
    considered: [{ action: 'PROBE_MECHANISM', score: 0.8, reason: 'claim is unexamined' }],
    chosen: 'PROBE_MECHANISM',
    pressureLevel: 0,
  }),
  at(6, 'policy_action', {
    attemptId: 'att_1',
    round: 'project_deep_dive',
    action: 'PROBE_MECHANISM',
    pressureLevel: 0,
    claimId: 'clm_1',
  }),
  at(7, 'question', {
    attemptId: 'att_1',
    text: 'How did the queue guarantee delivery?',
    invocation: invocation('inv_question', 'conductor'),
  }),
  at(8, 'state_change', { change: 'session_state', from: 'asking', to: 'awaiting_answer' }),
  at(9, 'answer', { attemptId: 'att_1', sourceId: 'src_answer_1', text: 'It retried on failure.' }),
  at(10, 'observation', {
    attemptId: 'att_1',
    note: 'candidate narrowed the claim under follow-up',
    spanIds: [],
  }),
  at(11, 'state_change', {
    change: 'pressure_level',
    from: 0,
    to: 1,
    reason: 'composure held twice',
  }),
  at(12, 'evaluation', {
    attemptId: 'att_1',
    spans: [],
    evidence: [],
    findings: [
      {
        id: 'fnd_1',
        attemptId: 'att_1',
        rubric: { id: 'claim_status', version: 1 },
        level: 'senior',
        rationale: 'retry alone does not establish delivery semantics',
        confidence: 0.6,
        modelVersion: 'test-model',
        promptVersion: '1',
        transcriptSpanIds: ['spn_answer_1'],
        evidenceIds: ['evd_1'],
        kind: 'claim',
        claimId: 'clm_1',
        verdict: 'partially_supported',
      },
    ],
    invocation: invocation('inv_eval', 'evaluator'),
  }),
  at(13, 'state_change', { change: 'gap_opened', gap }),
  at(14, 'state_change', {
    change: 'gap_status',
    gapId: 'gap_1',
    from: 'open',
    to: 'closed_under_transfer',
    attemptId: 'att_2',
  }),
  at(15, 'state_change', {
    change: 'ceiling_breach',
    ceiling: 'session_cost_usd',
    limit: 1,
    observed: 1.25,
  }),
  at(16, 'state_change', { change: 'session_closed', reason: 'session cost ceiling breached' }),
]

// Maps and Sets stringify to `{}`, which would make the identity assertion below vacuous.
function serialize(view: SessionView): string {
  return JSON.stringify(view, (_key, value: unknown) =>
    value instanceof Map
      ? Object.fromEntries(value)
      : value instanceof Set
        ? [...value]
        : (value as unknown),
  )
}

test('the hand-built log is a valid log', () => {
  for (const event of events) assertValidEvent(event, `fixture #${event.seq}`)
})

test('replay reconstructs the session from its events', () => {
  const view = replay(events)

  expect(view.sessionId).toBe(SESSION)
  expect(view.session).toEqual(session)
  expect(view.state).toBe('closed')
  expect(view.closed).toEqual({ reason: 'session cost ceiling breached' })
  expect(view.pressureLevel).toBe(1)

  expect([...view.sources.keys()]).toEqual(['src_resume', 'src_answer_1'])
  expect(view.spans.get('spn_1')).toEqual(span)
  expect(view.claims.get('clm_1')?.assertion).toBe('Built a job queue with Bun and Postgres')
  expect(view.claims.get('clm_1')?.confirmedByCandidate).toBe(true)
  expect([...view.confirmedClaimIds]).toEqual(['clm_1'])

  expect(view.transcript).toEqual([
    {
      role: 'interviewer',
      text: 'How did the queue guarantee delivery?',
      attemptId: 'att_1',
    },
    { role: 'candidate', text: 'It retried on failure.', attemptId: 'att_1' },
  ])

  expect(view.attempts.get('att_1')).toEqual({
    id: 'att_1',
    action: 'PROBE_MECHANISM',
    pressureLevel: 0,
    questionEventId: 'evt_7',
    claimId: 'clm_1',
  })

  expect(view.findings.map((f) => f.id)).toEqual(['fnd_1'])
  expect(view.gaps.get('gap_1')?.status).toBe('closed_under_transfer')
  expect(view.gaps.get('gap_1')?.transferAttemptIds).toEqual(['att_2'])

  expect(view.invocations.map((i) => i.id)).toEqual(['inv_extract', 'inv_question', 'inv_eval'])
  expect(view.totals).toEqual({ costUsd: 0.75, tokens: 360 })
})

test('replaying the same events twice is byte-identical', () => {
  expect(serialize(replay(events))).toBe(serialize(replay([...events])))
})

test('a hole in the seq is a corrupt log, not a gap', () => {
  const holed = events.filter((event) => event.seq !== 4)
  expect(() => replay(holed)).toThrow(/not gapless/)
})

test('events from another session cannot be folded in', () => {
  const mixed: AnyEvent[] = [
    events[0] as AnyEvent,
    { ...(events[1] as AnyEvent), sessionId: 'ses_other' },
  ]
  expect(() => replay(mixed)).toThrow(/belongs to session ses_other/)
})

test('an empty log folds to an empty view rather than throwing', () => {
  const view = replay([])
  expect(view.session).toBeNull()
  expect(view.state).toBe('selecting')
  expect(view.totals).toEqual({ costUsd: 0, tokens: 0 })
})
