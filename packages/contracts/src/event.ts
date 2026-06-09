import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { ClaimSchema } from './claim.ts'
import { DeliveryReportSchema } from './delivery.ts'
import { SnapshotTombstoneSchema } from './retention.ts'
import { ArtifactSchema, EvidenceSchema, SpanSchema } from './provenance.ts'
import { RoundKindSchema } from './round.ts'
import { SnapshotSchema } from './snapshot.ts'
import { FindingSchema } from './finding.ts'
import { GapEntrySchema, GapStatusSchema } from './gap.ts'
import { InvocationRecordSchema } from './invocation.ts'
import { PressureLevelSchema, SessionSchema, SessionStateSchema } from './session.ts'

export const EventKindSchema = Type.Union([
  Type.Literal('plan'),
  Type.Literal('policy_action'),
  Type.Literal('question'),
  Type.Literal('answer'),
  Type.Literal('observation'),
  Type.Literal('evaluation'),
  Type.Literal('state_change'),
])
export type EventKind = Static<typeof EventKindSchema>

// Code chooses the action; the model only renders words (ticket 05 §3) — this is input to rendering, never a Conductor output field.
export const PolicyActionSchema = Type.Union([
  Type.Literal('PROBE_MECHANISM'),
  Type.Literal('TEST_FAILURE_MODE'),
  Type.Literal('PROBE_TRADE_OFF'),
  Type.Literal('CHANGE_CONSTRAINT'),
  Type.Literal('REQUEST_EVIDENCE'),
  Type.Literal('DRILL'),
  Type.Literal('TRANSFER_TEST'),
  Type.Literal('INTERRUPT'),
  Type.Literal('FALSE_PREMISE'),
  Type.Literal('SUSTAINED_CHALLENGE'),
  Type.Literal('CONSTRAINT_SHOCK'),
  Type.Literal('TERSE_FOLLOW_UP'),
  Type.Literal('APPEAL_TO_AUTHORITY'),
  Type.Literal('END_TOPIC'),
])
export type PolicyAction = Static<typeof PolicyActionSchema>

export const PRESSURE_ACTIONS: readonly PolicyAction[] = [
  'INTERRUPT',
  'FALSE_PREMISE',
  'SUSTAINED_CHALLENGE',
  'CONSTRAINT_SHOCK',
  'TERSE_FOLLOW_UP',
  'APPEAL_TO_AUTHORITY',
]

export function isPressureAction(action: PolicyAction): boolean {
  return PRESSURE_ACTIONS.includes(action)
}

export { PressureLevelSchema }

export const SourceKindSchema = Type.Union([
  Type.Literal('resume'),
  Type.Literal('answer'),
  Type.Literal('artifact'),
])
export type SourceKind = Static<typeof SourceKindSchema>

const envelope = {
  eventId: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  // Gapless and per-session: replay is an ordered fold, so a hole is a corrupt log, not a gap.
  seq: Type.Integer({ minimum: 0 }),
  occurredAt: Type.String({ format: 'date-time' }),
  schemaVersion: Type.Integer({ minimum: 1 }),
  causedBy: Type.Optional(Type.String({ minLength: 1 })),
}

export const EVENT_SCHEMA_VERSION = 1

export function eventOf<K extends EventKind, P extends TSchema>(kind: K, payload: P) {
  return Type.Object({ ...envelope, kind: Type.Literal(kind), payload })
}

// Recorded before the action is taken, so "why did you ask that" is answered from the log, not reconstructed after.
export const PlanRecordedSchema = eventOf(
  'plan',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    considered: Type.Array(
      Type.Object({
        action: PolicyActionSchema,
        score: Type.Number(),
        reason: Type.String({ minLength: 1 }),
      }),
      { minItems: 1 },
    ),
    chosen: PolicyActionSchema,
    pressureLevel: PressureLevelSchema,
    // Present only with END_TOPIC — auditable in the plan that made the move, not inferred from the next action's claimId.
    nextClaimId: Type.Optional(Type.String({ minLength: 1 })),
  }),
)

export const PolicyActionSelectedSchema = eventOf(
  'policy_action',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    action: PolicyActionSchema,
    pressureLevel: PressureLevelSchema,
    claimId: Type.Optional(Type.String({ minLength: 1 })),
    round: RoundKindSchema,
    artifactId: Type.Optional(Type.String({ minLength: 1 })),
  }),
)

export const QuestionRenderedSchema = eventOf(
  'question',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    text: Type.String({ minLength: 1 }),
    invocation: InvocationRecordSchema,
  }),
)

export const AnswerReceivedSchema = eventOf(
  'answer',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    // Untrusted at every read boundary — the brand erases on serialization, so `untrusted()` is reapplied on read (ADR-014).
    sourceId: Type.String({ minLength: 1 }),
    text: Type.String(),
  }),
)

// Noticed, not judged (CONTEXT.md) — never carries a verdict or confidence.
export const ObservationRecordedSchema = eventOf(
  'observation',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    note: Type.String({ minLength: 1 }),
    spanIds: Type.Array(Type.String({ minLength: 1 })),
  }),
)

export const EvaluationProducedSchema = eventOf(
  'evaluation',
  Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    findings: Type.Array(FindingSchema, { minItems: 1 }),
    // Spans travel with the findings — one that lives only in memory can't be checked after the process exits.
    spans: Type.Array(SpanSchema),
    evidence: Type.Array(EvidenceSchema),
    invocation: InvocationRecordSchema,
  }),
)

// Discriminated on `change` so replay's fold stays exhaustive; a new variant can't be silently ignored.
export const StateChangeSchema = eventOf(
  'state_change',
  Type.Union([
    Type.Object({ change: Type.Literal('session_started'), session: SessionSchema }),
    Type.Object({
      change: Type.Literal('session_state'),
      from: SessionStateSchema,
      to: SessionStateSchema,
    }),
    Type.Object({
      change: Type.Literal('source_registered'),
      sourceId: Type.String({ minLength: 1 }),
      kind: SourceKindSchema,
      // Held in the log because span validity is checked byte-for-byte against it at replay.
      text: Type.String(),
      contentHash: Type.String({ minLength: 1 }),
    }),
    Type.Object({
      change: Type.Literal('claims_extracted'),
      claims: Type.Array(ClaimSchema),
      // Spans the claims are sourced to — kept beside them so replay can verify every claim resolves.
      spans: Type.Array(SpanSchema),
      invocation: InvocationRecordSchema,
    }),
    Type.Object({
      change: Type.Literal('claim_confirmed'),
      claimId: Type.String({ minLength: 1 }),
      confirmed: Type.Boolean(),
      editedAssertion: Type.Optional(Type.String({ minLength: 1 })),
    }),
    Type.Object({
      change: Type.Literal('pressure_level'),
      from: PressureLevelSchema,
      to: PressureLevelSchema,
      reason: Type.String({ minLength: 1 }),
    }),
    Type.Object({
      change: Type.Literal('round_started'),
      kind: RoundKindSchema,
      index: Type.Integer({ minimum: 0 }),
      // The line the interviewer opened the round with — rendered, so it's logged like everything else rendered.
      brief: Type.Optional(Type.String({ minLength: 1 })),
    }),
    // Snapshot is deletable (§7); the code itself is never copied here, only what was found in it.
    Type.Object({
      change: Type.Literal('snapshot_pinned'),
      snapshot: SnapshotSchema,
      artifacts: Type.Array(ArtifactSchema),
      evidence: Type.Array(EvidenceSchema),
    }),
    Type.Object({ change: Type.Literal('gap_opened'), gap: GapEntrySchema }),
    Type.Object({
      change: Type.Literal('gap_status'),
      gapId: Type.String({ minLength: 1 }),
      from: GapStatusSchema,
      to: GapStatusSchema,
      attemptId: Type.Optional(Type.String({ minLength: 1 })),
    }),
    // Ticket 10 §3: a breach is a named failure in the log, never a truncated context or partial evaluation.
    Type.Object({
      change: Type.Literal('ceiling_breach'),
      ceiling: Type.Union([
        Type.Literal('session_cost_usd'),
        Type.Literal('session_tokens'),
        Type.Literal('model_calls_per_turn'),
      ]),
      limit: Type.Number(),
      observed: Type.Number(),
    }),
    // Ticket 13: the bytes go, the citation stays. Replay after this reads artifact citations as
    // `snapshot_deleted`, which is neither a resolved citation nor a broken one.
    Type.Object({
      change: Type.Literal('snapshot_deleted'),
      tombstone: SnapshotTombstoneSchema,
    }),
    // Delivery is never competence (§7). It is recorded beside the interview, never inside a finding.
    Type.Object({
      change: Type.Literal('delivery_recorded'),
      report: DeliveryReportSchema,
    }),
    Type.Object({ change: Type.Literal('session_closed'), reason: Type.String({ minLength: 1 }) }),
  ]),
)

export const EventSchema = Type.Union([
  PlanRecordedSchema,
  PolicyActionSelectedSchema,
  QuestionRenderedSchema,
  AnswerReceivedSchema,
  ObservationRecordedSchema,
  EvaluationProducedSchema,
  StateChangeSchema,
])

export type AnyEvent = Static<typeof EventSchema>
export type EventOf<K extends EventKind> = Extract<AnyEvent, { kind: K }>
export type StateChange = EventOf<'state_change'>['payload']
export type StateChangeOf<C extends StateChange['change']> = Extract<StateChange, { change: C }>
