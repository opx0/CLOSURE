import { Type, type Static } from '@sinclair/typebox'
import { OwnerIdSchema } from './owner.ts'
import { NudgeSchema } from './nudge.ts'

export const JobKindSchema = Type.Union([
  Type.Literal('ingest_repository'),
  Type.Literal('build_export'),
  Type.Literal('sweep_retention'),
  Type.Literal('plan_retrieval'),
  Type.Literal('run_benchmark'),
  Type.Literal('send_nudge'),
])
export type JobKind = Static<typeof JobKindSchema>

export const JobStateSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('leased'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('dead'),
])
export type JobState = Static<typeof JobStateSchema>

export const IngestRepositoryPayloadSchema = Type.Object({
  kind: Type.Literal('ingest_repository'),
  repoPath: Type.String({ minLength: 1 }),
  ref: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
})

export const BuildExportPayloadSchema = Type.Object({
  kind: Type.Literal('build_export'),
  destination: Type.String({ minLength: 1 }),
})

export const SweepRetentionPayloadSchema = Type.Object({
  kind: Type.Literal('sweep_retention'),
  snapshotMaxAgeDays: Type.Integer({ minimum: 1 }),
})

export const PlanRetrievalPayloadSchema = Type.Object({
  kind: Type.Literal('plan_retrieval'),
  horizonDays: Type.Integer({ minimum: 1 }),
})

export const RunBenchmarkPayloadSchema = Type.Object({
  kind: Type.Literal('run_benchmark'),
  fixturesDir: Type.String({ minLength: 1 }),
  outDir: Type.String({ minLength: 1 }),
  portsModule: Type.String({ minLength: 1 }),
  bar: Type.Union([Type.Literal('self_use'), Type.Literal('flagship')]),
  labelsFile: Type.Optional(Type.String({ minLength: 1 })),
})

// Sending is durable work with an outside effect, so it is a job like every other: leased,
// idempotent by key, and buried with its error rather than retried forever.
export const SendNudgePayloadSchema = Type.Object({
  kind: Type.Literal('send_nudge'),
  nudge: NudgeSchema,
  dryRun: Type.Boolean(),
})

export const JobPayloadSchema = Type.Union([
  IngestRepositoryPayloadSchema,
  BuildExportPayloadSchema,
  SweepRetentionPayloadSchema,
  PlanRetrievalPayloadSchema,
  RunBenchmarkPayloadSchema,
  SendNudgePayloadSchema,
])
export type JobPayload = Static<typeof JobPayloadSchema>
export type JobPayloadOf<K extends JobKind> = Extract<JobPayload, { kind: K }>

export const JobRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  ownerId: OwnerIdSchema,
  kind: JobKindSchema,
  idempotencyKey: Type.String({ minLength: 1 }),
  payload: JobPayloadSchema,
  state: JobStateSchema,
  attempts: Type.Integer({ minimum: 0 }),
  maxAttempts: Type.Integer({ minimum: 1 }),
  runAfter: Type.String({ format: 'date-time' }),
  leaseOwner: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  leaseExpiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
})
export type JobRecord = Static<typeof JobRecordSchema>
