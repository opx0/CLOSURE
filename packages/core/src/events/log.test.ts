import { expect, test } from 'bun:test'
import type { AnyEvent } from '@levelhead/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'
import { AppendOnlyViolation, type EventStore } from '../ports/event-store.ts'
import { SessionLog } from './log.ts'

class MemoryStore implements EventStore {
  readonly written: AnyEvent[] = []
  rejectNext = false

  async append(event: AnyEvent): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false
      throw new AppendOnlyViolation(event.sessionId, event.seq)
    }
    if (this.written.some((e) => e.sessionId === event.sessionId && e.seq === event.seq)) {
      throw new AppendOnlyViolation(event.sessionId, event.seq)
    }
    this.written.push(event)
  }

  async read(sessionId: string): Promise<AnyEvent[]> {
    return this.written.filter((e) => e.sessionId === sessionId)
  }

  async listSessions(): Promise<string[]> {
    return [...new Set(this.written.map((e) => e.sessionId))]
  }
}

const clock: Clock = { now: () => '2026-09-09T10:00:00.000Z' }

function ids(): IdSource {
  let n = 0
  return { next: (prefix) => `${prefix}_${n++}` }
}

function deps(store: MemoryStore): { store: EventStore; clock: Clock; ids: IdSource } {
  return { store, clock, ids: ids() }
}

test('allocates gapless seq starting at 0', async () => {
  const store = new MemoryStore()
  const log = await SessionLog.open(deps(store), 's1')

  await log.append('state_change', { change: 'session_state', from: 'selecting', to: 'asking' })
  await log.append('observation', { attemptId: 'a1', note: 'revised the claim', spanIds: [] })
  await log.append('state_change', { change: 'session_closed', reason: 'done' })

  expect(store.written.map((e) => e.seq)).toEqual([0, 1, 2])
  expect(store.written.map((e) => e.eventId)).toEqual(['evt_0', 'evt_1', 'evt_2'])
  expect(log.events().map((e) => e.seq)).toEqual([0, 1, 2])
})

test('reopening a session continues the log rather than restarting it', async () => {
  const store = new MemoryStore()
  const first = await SessionLog.open(deps(store), 's1')
  await first.append('state_change', { change: 'session_closed', reason: 'interrupted' })

  const reopened = await SessionLog.open(deps(store), 's1')
  const event = await reopened.append('observation', { attemptId: 'a1', note: 'back', spanIds: [] })

  expect(event.seq).toBe(1)
  expect(reopened.events().map((e) => e.seq)).toEqual([0, 1])
})

test('a rejected append leaves no hole in the seq', async () => {
  const store = new MemoryStore()
  const log = await SessionLog.open(deps(store), 's1')

  store.rejectNext = true
  await expect(
    log.append('state_change', { change: 'session_closed', reason: 'first' }),
  ).rejects.toBeInstanceOf(AppendOnlyViolation)

  const retried = await log.append('state_change', { change: 'session_closed', reason: 'second' })
  expect(retried.seq).toBe(0)
  expect(log.events()).toHaveLength(1)
})

test('a malformed payload is refused before it reaches the store, naming the path', async () => {
  const store = new MemoryStore()
  const log = await SessionLog.open(deps(store), 's1')

  await expect(
    log.append('state_change', { change: 'session_closed', reason: '' }),
  ).rejects.toThrow(/\/payload/)
  expect(store.written).toHaveLength(0)
})

test('an absent causedBy stays absent rather than serializing as null', async () => {
  const store = new MemoryStore()
  const log = await SessionLog.open(deps(store), 's1')

  const plain = await log.append('observation', { attemptId: 'a1', note: 'n', spanIds: [] })
  const caused = await log.append(
    'observation',
    { attemptId: 'a1', note: 'n', spanIds: [] },
    'evt_0',
  )

  expect(JSON.parse(JSON.stringify(plain))).not.toHaveProperty('causedBy')
  expect(caused.causedBy).toBe('evt_0')
})
