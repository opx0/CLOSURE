import { expect, test } from 'bun:test'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_OWNER_ID, EVENT_SCHEMA_VERSION, type AnyEvent } from '@levelhead/contracts'
import { AppendOnlyViolation, SessionLog, replay, type Clock, type IdSource } from '@levelhead/core'
import { JsonlEventStore } from './jsonl.ts'

const AT = '2026-09-09T10:00:00.000Z'

function event(seq: number, reason: string, sessionId = 'ses_1'): AnyEvent {
  return {
    eventId: `evt_${seq}`,
    sessionId,
    seq,
    occurredAt: AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind: 'state_change',
    payload: { change: 'session_closed', reason },
  }
}

async function withStore(
  run: (store: JsonlEventStore, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-events-'))
  try {
    const owned = join(dir, LOCAL_OWNER_ID)
    await mkdir(owned, { recursive: true })
    await run(new JsonlEventStore(dir), owned)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('appends and reads back the events it wrote, in order', async () => {
  await withStore(async (store) => {
    await store.append(event(0, 'first'))
    await store.append(event(1, 'second'))

    expect(await store.read('ses_1')).toEqual([event(0, 'first'), event(1, 'second')])
    expect(await store.read('ses_unwritten')).toEqual([])
  })
})

test('a duplicate seq is rejected even when a fresh process wrote the original', async () => {
  await withStore(async (store, dir) => {
    await store.append(event(0, 'first'))

    // A second store instance has no in-memory counter at all, so the check can only come off disk.
    const reopened = new JsonlEventStore(dir)
    await expect(reopened.append(event(0, 'rewritten'))).rejects.toBeInstanceOf(AppendOnlyViolation)
    expect(await store.read('ses_1')).toEqual([event(0, 'first')])
  })
})

test('a seq that would leave a hole is rejected', async () => {
  await withStore(async (store) => {
    await store.append(event(0, 'first'))
    await expect(store.append(event(2, 'skipped'))).rejects.toThrow(/hole/)
  })
})

test('a corrupt line names the file and the line number', async () => {
  await withStore(async (store, dir) => {
    await store.append(event(0, 'first'))
    await appendFile(join(dir, 'ses_1.jsonl'), 'not json\n', 'utf8')

    await expect(store.read('ses_1')).rejects.toThrow(/ses_1\.jsonl:2/)
  })
})

test('a line that is valid JSON but not a valid event is refused', async () => {
  await withStore(async (store, dir) => {
    await appendFile(
      join(dir, 'ses_1.jsonl'),
      `${JSON.stringify({ ...event(0, 'first'), occurredAt: 'yesterday' })}\n`,
      'utf8',
    )

    await expect(store.read('ses_1')).rejects.toThrow(/occurredAt/)
  })
})

test('listSessions reports one session per file', async () => {
  await withStore(async (store, dir) => {
    expect(await store.listSessions()).toEqual([])
    await store.append(event(0, 'a'))
    await store.append(event(0, 'b', 'ses_2'))
    await appendFile(join(dir, 'notes.txt'), 'ignored\n', 'utf8')

    expect(await store.listSessions()).toEqual(['ses_1', 'ses_2'])
  })
})

test('a session id that would escape the log directory is refused', async () => {
  await withStore(async (store) => {
    await expect(store.read('../../etc/passwd')).rejects.toThrow(/not usable as a log filename/)
  })
})

test('a session written, reopened and replayed comes back whole', async () => {
  await withStore(async (store) => {
    const clock: Clock = { now: () => AT }
    let n = 0
    const ids: IdSource = { next: (prefix) => `${prefix}_${n++}` }

    const first = await SessionLog.open({ store, clock, ids }, 'ses_1')
    await first.append('state_change', { change: 'session_state', from: 'selecting', to: 'asking' })
    await first.append('observation', { attemptId: 'att_1', note: 'noted', spanIds: [] })

    const reopened = await SessionLog.open({ store, clock, ids }, 'ses_1')
    await reopened.append('state_change', { change: 'session_closed', reason: 'done' })

    const view = replay(await store.read('ses_1'))
    expect(view.state).toBe('closed')
    expect(view.closed).toEqual({ reason: 'done' })
    expect(reopened.events().map((e) => e.seq)).toEqual([0, 1, 2])
  })
})

test('one owner never reads another owner’s log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-owners-'))
  try {
    const mine = new JsonlEventStore(dir, 'abhisek')
    const theirs = new JsonlEventStore(dir, 'friend')

    await mine.append(event(0, 'mine'))
    await theirs.append(event(0, 'theirs'))

    expect(await mine.read('ses_1')).toEqual([event(0, 'mine')])
    expect(await theirs.read('ses_1')).toEqual([event(0, 'theirs')])
    expect(await mine.listSessions()).toEqual(['ses_1'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// The boundary landed after logs already existed. The local owner still reads them; a second owner
// never does, because inheriting someone else's log by being first is the failure this prevents.
test('the local owner still reads a log written before the boundary existed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-legacy-'))
  try {
    await writeFile(join(dir, 'ses_1.jsonl'), `${JSON.stringify(event(0, 'legacy'))}\n`, 'utf8')

    expect(await new JsonlEventStore(dir).read('ses_1')).toEqual([event(0, 'legacy')])
    expect(await new JsonlEventStore(dir).listSessions()).toEqual(['ses_1'])
    expect(await new JsonlEventStore(dir, 'friend').read('ses_1')).toEqual([])
    expect(await new JsonlEventStore(dir, 'friend').listSessions()).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an owner id that could escape the log directory is refused', () => {
  expect(() => new JsonlEventStore('.levelhead/events', '../../etc')).toThrow(/not usable/)
})
