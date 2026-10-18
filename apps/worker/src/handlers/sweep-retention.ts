import { SessionLog, pinnedSnapshots, snapshotIsExpired, tombstoneFor } from '@levelhead/core'
import type { JobRecord } from '@levelhead/contracts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { HandlerContext } from './context.ts'

export async function sweepRetention(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'sweep_retention') throw new Error('wrong payload for retention sweep')

  const policy = { snapshotMaxAgeDays: job.payload.snapshotMaxAgeDays }
  const now = context.clock.now()
  const live = await context.retrieval.liveSnapshots(job.ownerId)
  const expired = live.filter((record) => snapshotIsExpired(record.snapshot, now, policy))
  for (const record of expired) {
    await context.retrieval.markDeleted(job.ownerId, record.snapshot.id, 'retention_expired', now)
  }

  // Authoritative deletion always wins before mirroring. Enumerating durable tombstones also
  // repairs earlier append failures (including manual deletion), even when no live rows remain.
  const deleted = await context.retrieval.deletedSnapshots(job.ownerId)
  const store = context.storeFor(job.ownerId)
  const log = await SessionLog.open({ store, clock: context.clock, ids: context.ids }, REPO_SESSION)
  const events = log.events()
  const mirrored = new Set(
    events.flatMap((event) =>
      event.kind === 'state_change' && event.payload.change === 'snapshot_deleted'
        ? [event.payload.tombstone.snapshotId]
        : [],
    ),
  )
  const pins = new Map(pinnedSnapshots(events).map((entry) => [entry.snapshot.id, entry]))
  for (const record of deleted) {
    if (mirrored.has(record.snapshot.id)) continue
    const pin = pins.get(record.snapshot.id)
    const reason = record.reason
    if (
      !pin ||
      (reason !== 'retention_expired' &&
        reason !== 'candidate_requested' &&
        reason !== 'ingestion_superseded')
    ) {
      // Legacy rows may lack a pin/artifact list or a protocol-supported reason. Neither a
      // file count nor a guessed reason is an honest substitute for missing tombstone metadata.
      context.logger.log('warn', 'snapshot deletion mirror lacks supported metadata', {
        jobId: job.id,
        ownerId: job.ownerId,
        snapshotId: record.snapshot.id,
      })
      continue
    }
    await log.append('state_change', {
      change: 'snapshot_deleted',
      tombstone: tombstoneFor({
        snapshot: record.snapshot,
        contentHash: record.contentHash,
        artifactCount: pin.artifacts.length,
        reason,
        deletedAt: record.deletedAt,
      }),
    })
    mirrored.add(record.snapshot.id)
  }

  context.logger.log('info', 'retention sweep deleted expired snapshots', {
    jobId: job.id,
    ownerId: job.ownerId,
    deleted: expired.length,
  })
}
