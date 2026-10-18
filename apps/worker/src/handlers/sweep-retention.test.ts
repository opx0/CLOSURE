import { expect, test } from 'bun:test'
import { SessionLog, silentLogger } from '@levelhead/core'
import type { AnyEvent, JobRecord, Snapshot } from '@levelhead/contracts'
import { FixedClock, MemoryEventStore, SeqIds } from '../../../cli/src/testing/fakes.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { sweepRetention } from './sweep-retention.ts'
import type { HandlerContext } from './context.ts'

test('retention retry repairs a DB-first deletion after append fails, without live snapshots or duplicate mirrors', async () => {
  const owner = 'owner_retention'
  const snapshot: Snapshot = {
    id: 'snapshot_retention',
    repoPath: 'authored://retention',
    commit: 'a'.repeat(40),
    fileCount: 1,
    pinnedAt: '2025-01-01T00:00:00.000Z',
  }
  let failAppend = false
  class FailingStore extends MemoryEventStore {
    override async append(event: AnyEvent) {
      if (failAppend) throw new Error('scripted append failure')
      await super.append(event)
    }
  }
  const store = new FailingStore()
  const otherStore = new MemoryEventStore()
  const clock = new FixedClock()
  const ids = new SeqIds()
  const log = await SessionLog.open({ store, clock, ids }, REPO_SESSION)
  await log.append('state_change', {
    change: 'snapshot_pinned',
    snapshot,
    artifacts: (['file', 'function'] as const).map((kind, index) => ({
      id: `artifact_${index}`,
      snapshotId: snapshot.id,
      kind,
      path: 'queue.ts',
    })),
    evidence: [],
  })
  const record = { snapshot, contentHash: 'persisted-content-hash' }
  let deletion: (typeof record & { reason: string; deletedAt: string }) | undefined
  let content: string | undefined = 'source bytes'
  const retrieval = {
    async liveSnapshots(scope: string) {
      return scope === owner && !deletion ? [record] : []
    },
    async deletedSnapshots(scope: string) {
      return scope === owner && deletion ? [deletion] : []
    },
    async markDeleted(scope: string, id: string, reason: string, deletedAt: string) {
      expect(scope).toBe(owner)
      expect(id).toBe(snapshot.id)
      deletion ??= { ...record, reason, deletedAt }
      content = undefined
    },
  }
  // Scripted persistence seam; native deletion/isolation is checked in the DB integration suite.
  const context = {
    storeFor: (scope: string) => {
      return scope === owner ? store : otherStore
    },
    retrieval,
    clock,
    ids,
    logger: silentLogger,
  } as unknown as HandlerContext
  const job = {
    id: 'job_retention',
    ownerId: owner,
    payload: { kind: 'sweep_retention', snapshotMaxAgeDays: 90 },
  } as JobRecord
  failAppend = true
  await expect(sweepRetention(job, context)).rejects.toThrow('scripted append failure')
  expect(content).toBeUndefined()
  expect(await retrieval.liveSnapshots(owner)).toEqual([])
  failAppend = false
  await sweepRetention({ ...job, ownerId: 'other_owner' }, context)
  expect(await otherStore.read(REPO_SESSION)).toEqual([])
  expect(await store.read(REPO_SESSION)).toHaveLength(1)
  await sweepRetention(job, context)
  expect(content).toBeUndefined()
  await sweepRetention(job, context)
  const deleted = (await store.read(REPO_SESSION)).filter(
    (event) => event.kind === 'state_change' && event.payload.change === 'snapshot_deleted',
  )
  expect(deleted).toHaveLength(1)
  expect(deleted[0]?.payload).toEqual({
    change: 'snapshot_deleted',
    tombstone: {
      snapshotId: snapshot.id,
      commit: snapshot.commit,
      contentHash: record.contentHash,
      artifactCount: 2,
      reason: 'retention_expired',
      deletedAt: deletion!.deletedAt,
    },
  })
  expect(content).toBeUndefined()
})

test('sweep mirrors prior manual deletion with its persisted time/reason, not the sweep time', async () => {
  const snapshot: Snapshot = {
    id: 'snapshot_manual',
    repoPath: 'authored://manual',
    commit: 'b'.repeat(40),
    fileCount: 1,
    pinnedAt: '2026-09-01T00:00:00.000Z',
  }
  const store = new MemoryEventStore()
  const clock = new FixedClock()
  const ids = new SeqIds()
  const log = await SessionLog.open({ store, clock, ids }, REPO_SESSION)
  await log.append('state_change', {
    change: 'snapshot_pinned',
    snapshot,
    artifacts: [],
    evidence: [],
  })
  const deletedAt = '2026-09-08T12:34:56.789Z'
  const warnings: unknown[] = []
  const context = {
    storeFor: () => store,
    retrieval: {
      async liveSnapshots() {
        return []
      },
      async deletedSnapshots() {
        return [
          { snapshot, contentHash: 'original-hash', reason: 'candidate_requested', deletedAt },
          // No event pin: artifactCount is unavailable, not the legacy file count.
          { snapshot: { ...snapshot, id: 'legacy' }, reason: 'candidate_requested', deletedAt },
        ]
      },
      async markDeleted() {
        throw new Error('must not rewrite a prior deletion')
      },
    },
    clock,
    ids,
    logger: {
      log(level: string, ...args: unknown[]) {
        if (level === 'warn') warnings.push(args)
      },
    },
  } as unknown as HandlerContext
  const job = {
    id: 'job_manual',
    ownerId: 'owner_manual',
    payload: { kind: 'sweep_retention', snapshotMaxAgeDays: 90 },
  } as JobRecord
  await sweepRetention(job, context)
  await sweepRetention(job, context)
  expect((await store.read(REPO_SESSION)).map((event) => event.payload)).toEqual([
    { change: 'snapshot_pinned', snapshot, artifacts: [], evidence: [] },
    {
      change: 'snapshot_deleted',
      tombstone: {
        snapshotId: snapshot.id,
        commit: snapshot.commit,
        contentHash: 'original-hash',
        artifactCount: 0,
        reason: 'candidate_requested',
        deletedAt,
      },
    },
  ])
  expect(warnings).toHaveLength(2)
})
