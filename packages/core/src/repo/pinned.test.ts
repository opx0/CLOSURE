import { expect, test } from 'bun:test'
import type { AnyEvent, Artifact, Snapshot } from '@levelhead/contracts'
import { openPinned, pinnedSnapshots } from './pinned.ts'

let seq = 0

function event(payload: AnyEvent['payload']): AnyEvent {
  seq += 1
  return {
    eventId: `evt_${seq}`,
    sessionId: 'repo',
    seq,
    occurredAt: '2026-09-24T09:00:00.000Z',
    schemaVersion: 1,
    kind: 'state_change',
    payload,
  } as AnyEvent
}

function snapshot(id: string): Snapshot {
  return {
    id,
    repoPath: `/work/${id}`,
    commit: 'abc1234',
    pinnedAt: '2026-09-24T09:00:00.000Z',
    fileCount: 1,
  }
}

function artifact(id: string, snapshotId: string): Artifact {
  return { id, snapshotId, kind: 'function', path: `src/${id}.ts`, symbol: id }
}

function pin(id: string): AnyEvent {
  return event({
    change: 'snapshot_pinned',
    snapshot: snapshot(id),
    artifacts: [artifact(`${id}_art`, id)],
    evidence: [],
  })
}

function unpin(id: string): AnyEvent {
  return event({
    change: 'snapshot_deleted',
    tombstone: {
      snapshotId: id,
      commit: 'abc1234',
      contentHash: 'abc1234',
      artifactCount: 1,
      reason: 'candidate_requested',
      deletedAt: '2026-09-24T10:00:00.000Z',
    },
  })
}

// Replay's fold would name B, the latest pin, and hand over both pins' artifacts.
test('a walkthrough opens the latest project still pinned, with that project’s code alone', () => {
  const log = [pin('snap_a'), pin('snap_b'), unpin('snap_b')]

  expect(pinnedSnapshots(log).map((entry) => [entry.snapshot.id, entry.deleted])).toEqual([
    ['snap_a', false],
    ['snap_b', true],
  ])
  const opened = openPinned(log)
  expect(opened?.snapshot.id).toBe('snap_a')
  expect(opened?.artifacts.map((each) => each.id)).toEqual(['snap_a_art'])
  expect(openPinned(log, 'snap_b')).toBeUndefined()
  expect(openPinned(log, 'snap_a')?.snapshot.id).toBe('snap_a')
})
