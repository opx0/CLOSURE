import { SessionLog, snapshotIsExpired, tombstoneFor } from '@closer/core'
import type { JobRecord } from '@closer/contracts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { HandlerContext } from './context.ts'

export async function sweepRetention(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'sweep_retention') throw new Error('wrong payload for retention sweep')

  const policy = { snapshotMaxAgeDays: job.payload.snapshotMaxAgeDays }
  const now = context.clock.now()
  const live = await context.retrieval.liveSnapshots(job.ownerId)
  const expired = live.filter((record) => snapshotIsExpired(record.snapshot, now, policy))
  if (expired.length === 0) {
    context.logger.log('info', 'retention sweep found nothing expired', {
      jobId: job.id,
      ownerId: job.ownerId,
      live: live.length,
    })
    return
  }

  const store = context.storeFor(job.ownerId)
  const log = await SessionLog.open({ store, clock: context.clock, ids: context.ids }, REPO_SESSION)

  for (const record of expired) {
    // The citation survives its bytes: a tombstone is appended before the content is dropped, so a
    // replay that runs after this reads `snapshot_deleted`, not a broken citation.
    await log.append('state_change', {
      change: 'snapshot_deleted',
      tombstone: tombstoneFor({
        snapshot: record.snapshot,
        contentHash: record.contentHash,
        artifactCount: record.snapshot.fileCount,
        reason: 'retention_expired',
        deletedAt: now,
      }),
    })
    await context.retrieval.markDeleted(job.ownerId, record.snapshot.id, 'retention_expired', now)
  }

  context.logger.log('info', 'retention sweep deleted expired snapshots', {
    jobId: job.id,
    ownerId: job.ownerId,
    deleted: expired.length,
  })
}
