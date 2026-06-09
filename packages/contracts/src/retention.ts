import { Type, type Static } from '@sinclair/typebox'

export const DEFAULT_SNAPSHOT_RETENTION_DAYS = 90

export const DeletionReasonSchema = Type.Union([
  Type.Literal('candidate_requested'),
  Type.Literal('retention_expired'),
  Type.Literal('ingestion_superseded'),
])
export type DeletionReason = Static<typeof DeletionReasonSchema>

// Four outcomes, not two. A citation into a source this session's log does not carry — a claim's
// résumé span, which lives in the claim-set log — is not a broken citation, and reporting it as one
// would tell the candidate their evidence failed when it did not.
export const CitationAvailabilitySchema = Type.Union([
  Type.Literal('resolved'),
  Type.Literal('unresolvable'),
  Type.Literal('snapshot_deleted'),
  Type.Literal('not_in_this_session'),
])
export type CitationAvailability = Static<typeof CitationAvailabilitySchema>

export const SnapshotTombstoneSchema = Type.Object({
  snapshotId: Type.String({ minLength: 1 }),
  commit: Type.String({ minLength: 1 }),
  contentHash: Type.String({ minLength: 1 }),
  artifactCount: Type.Integer({ minimum: 0 }),
  reason: DeletionReasonSchema,
  deletedAt: Type.String({ format: 'date-time' }),
})
export type SnapshotTombstone = Static<typeof SnapshotTombstoneSchema>
