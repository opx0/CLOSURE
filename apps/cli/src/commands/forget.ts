import {
  DEFAULT_RETENTION,
  SessionLog,
  replay,
  snapshotExpiresAt,
  snapshotIsExpired,
  tombstoneFor,
} from '@levelhead/core'
import type { DeletionReason } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { REPO_SESSION } from './repo.ts'
import { dim, heading, line } from '../terminal.ts'

// The snapshot's bytes are deletable; the citation is not. After this, a replay of an older
// session reads its artifact citations as `snapshot_deleted` — not resolved, and not broken.
export async function forget(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)
  const clock = new SystemClock()
  const ids = new RandomIds()

  try {
    const view = replay(await store.read(REPO_SESSION))
    if (view.snapshot === null) {
      line('nothing pinned — there is no snapshot to forget.')
      return 1
    }
    const snapshot = view.snapshot
    if (view.tombstones.some((stone) => stone.snapshotId === snapshot.id)) {
      line(`${snapshot.id} was already deleted.`)
      return 0
    }

    const expiredOnly = argv.includes('--expired')
    const expiresAt = snapshotExpiresAt(snapshot, DEFAULT_RETENTION)
    if (expiredOnly && !snapshotIsExpired(snapshot, clock.now(), DEFAULT_RETENTION)) {
      line(`${snapshot.id} is not expired yet — it expires ${expiresAt.slice(0, 10)}.`)
      return 0
    }

    const reason: DeletionReason = expiredOnly ? 'retention_expired' : 'candidate_requested'
    const tombstone = tombstoneFor({
      snapshot,
      contentHash: snapshot.commit,
      artifactCount: view.artifacts.size,
      reason,
      deletedAt: clock.now(),
    })

    const log = await SessionLog.open({ store, clock, ids }, REPO_SESSION)
    await log.append('state_change', { change: 'snapshot_deleted', tombstone })

    heading('forgotten')
    line(`  ${snapshot.id} at ${snapshot.commit.slice(0, 12)}`)
    dim(`  ${tombstone.artifactCount} artifacts · reason ${reason.replace(/_/g, ' ')}`)
    dim('  past sessions still replay; their artifact citations now read "snapshot deleted".')
    return 0
  } finally {
    await close()
  }
}
