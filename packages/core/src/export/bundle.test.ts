import { expect, test } from 'bun:test'
import { EVENT_SCHEMA_VERSION, EXPORT_FORMAT_VERSION, type AnyEvent } from '@levelhead/contracts'
import { buildExportBundle, exportSession } from './bundle.ts'

const AT = '2026-09-09T10:00:00.000Z'

function event(seq: number, payload: AnyEvent['payload'], sessionId = 'ses_1'): AnyEvent {
  return {
    eventId: `evt_${sessionId}_${seq}`,
    sessionId,
    seq,
    occurredAt: AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind: 'state_change',
    payload,
  } as AnyEvent
}

const RESUME = 'Built a durable job queue on PostgreSQL.'

test('the bundle carries the raw events, not only the view they fold into', () => {
  const events = [
    event(0, {
      change: 'source_registered',
      sourceId: 'resume:1',
      kind: 'resume',
      text: RESUME,
      contentHash: 'hash',
    }),
    event(1, { change: 'session_closed', reason: 'turns' }),
  ]

  const exported = exportSession({ sessionId: 'ses_1', events })

  expect(exported.events).toEqual(events)
  expect(exported.sessionId).toBe('ses_1')
})

test('an empty session is left out rather than exported as a session that produced nothing', () => {
  const bundle = buildExportBundle({
    ownerId: 'local',
    producedAt: AT,
    sessions: [
      { sessionId: 'ses_1', events: [event(0, { change: 'session_closed', reason: 'turns' })] },
      { sessionId: 'ses_empty', events: [] },
    ],
  })

  expect(bundle.formatVersion).toBe(EXPORT_FORMAT_VERSION)
  expect(bundle.sessions.map((session) => session.sessionId)).toEqual(['ses_1'])
})

// The export is the deletion promise's other half: it must say what a deleted snapshot means, not
// quietly omit the fact that one was deleted.
test('a deleted snapshot travels in the export as its tombstone', () => {
  const snapshot = {
    id: 'snapshot_1',
    repoPath: '/srv/queue',
    commit: 'b'.repeat(40),
    pinnedAt: AT,
    fileCount: 1,
  }
  const exported = exportSession({
    sessionId: 'ses_1',
    events: [
      event(0, { change: 'snapshot_pinned', snapshot, artifacts: [], evidence: [] }),
      event(1, {
        change: 'snapshot_deleted',
        tombstone: {
          snapshotId: snapshot.id,
          commit: snapshot.commit,
          contentHash: 'hash',
          artifactCount: 0,
          reason: 'candidate_requested',
          deletedAt: AT,
        },
      }),
    ],
  })

  expect(exported.tombstones).toHaveLength(1)
  expect(exported.tombstones[0]?.reason).toBe('candidate_requested')
})
