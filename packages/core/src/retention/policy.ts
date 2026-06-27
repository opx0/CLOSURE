import { DEFAULT_SNAPSHOT_RETENTION_DAYS } from '@closer/contracts'
import type {
  CitationAvailability,
  DeletionReason,
  Evidence,
  Snapshot,
  SnapshotTombstone,
} from '@closer/contracts'
import { resolveSpan } from '../events/sources.ts'
import type { SessionView } from '../events/replay.ts'

const DAY_MS = 24 * 60 * 60 * 1_000

export interface RetentionPolicy {
  snapshotMaxAgeDays: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  snapshotMaxAgeDays: DEFAULT_SNAPSHOT_RETENTION_DAYS,
}

export function snapshotExpiresAt(snapshot: Snapshot, policy: RetentionPolicy): string {
  return new Date(Date.parse(snapshot.pinnedAt) + policy.snapshotMaxAgeDays * DAY_MS).toISOString()
}

export function snapshotIsExpired(
  snapshot: Snapshot,
  now: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): boolean {
  return Date.parse(now) >= Date.parse(snapshotExpiresAt(snapshot, policy))
}

export function tombstoneFor(input: {
  snapshot: Snapshot
  contentHash: string
  artifactCount: number
  reason: DeletionReason
  deletedAt: string
}): SnapshotTombstone {
  return {
    snapshotId: input.snapshot.id,
    commit: input.snapshot.commit,
    contentHash: input.contentHash,
    artifactCount: input.artifactCount,
    reason: input.reason,
    deletedAt: input.deletedAt,
  }
}

export function citationAvailability(link: Evidence, view: SessionView): CitationAvailability {
  if (link.target.kind === 'span') {
    const span = view.spans.get(link.target.spanId)
    // A claim's résumé span lives in the claim-set log, not in the session that cited it. Absent
    // here means "not checkable from this session", which is not the same as broken.
    if (span === undefined) return 'not_in_this_session'
    if (!view.sources.has(span.sourceId)) return 'not_in_this_session'
    return resolveSpan(span, view.sources).ok ? 'resolved' : 'unresolvable'
  }

  const artifact = view.artifacts.get(link.target.artifactId)
  if (artifact === undefined) return 'not_in_this_session'
  const deleted = view.tombstones.some((tombstone) => tombstone.snapshotId === artifact.snapshotId)
  return deleted ? 'snapshot_deleted' : 'resolved'
}

export interface AvailabilitySummary {
  resolved: number
  unresolvable: number
  snapshotDeleted: number
  notInThisSession: number
}

export function availabilitySummary(view: SessionView): AvailabilitySummary {
  const summary: AvailabilitySummary = {
    resolved: 0,
    unresolvable: 0,
    snapshotDeleted: 0,
    notInThisSession: 0,
  }
  for (const link of view.evidence.values()) {
    const availability = citationAvailability(link, view)
    if (availability === 'resolved') summary.resolved += 1
    else if (availability === 'unresolvable') summary.unresolvable += 1
    else if (availability === 'snapshot_deleted') summary.snapshotDeleted += 1
    else summary.notInThisSession += 1
  }
  return summary
}
