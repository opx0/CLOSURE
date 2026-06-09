import { Type, type Static } from '@sinclair/typebox'
import { ClaimSchema } from './claim.ts'
import { EventSchema } from './event.ts'
import { FindingSchema } from './finding.ts'
import { GapEntrySchema } from './gap.ts'
import { InvocationRecordSchema } from './invocation.ts'
import { ArtifactSchema, EvidenceSchema, SpanSchema } from './provenance.ts'
import { OwnerIdSchema } from './owner.ts'
import { SessionSchema } from './session.ts'
import { SnapshotSchema } from './snapshot.ts'
import { SnapshotTombstoneSchema } from './retention.ts'

export const EXPORT_FORMAT_VERSION = 1

export const ExportedSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  session: Type.Union([SessionSchema, Type.Null()]),
  events: Type.Array(EventSchema),
  transcript: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal('interviewer'), Type.Literal('candidate')]),
      text: Type.String(),
      attemptId: Type.String({ minLength: 1 }),
    }),
  ),
  claims: Type.Array(ClaimSchema),
  spans: Type.Array(SpanSchema),
  evidence: Type.Array(EvidenceSchema),
  artifacts: Type.Array(ArtifactSchema),
  findings: Type.Array(FindingSchema),
  gaps: Type.Array(GapEntrySchema),
  invocations: Type.Array(InvocationRecordSchema),
  snapshot: Type.Union([SnapshotSchema, Type.Null()]),
  tombstones: Type.Array(SnapshotTombstoneSchema),
})
export type ExportedSession = Static<typeof ExportedSessionSchema>

export const ExportBundleSchema = Type.Object({
  formatVersion: Type.Integer({ minimum: 1 }),
  ownerId: OwnerIdSchema,
  producedAt: Type.String({ format: 'date-time' }),
  sessions: Type.Array(ExportedSessionSchema),
  note: Type.String({ minLength: 1 }),
})
export type ExportBundle = Static<typeof ExportBundleSchema>
