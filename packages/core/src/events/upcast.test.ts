import { expect, test } from 'bun:test'
import { EVENT_SCHEMA_VERSION } from '@closer/contracts'
import { replay } from './replay.ts'
import { UPCASTERS, UpcastGap, readEvent, upcastEvent, type Upcaster } from './upcast.ts'

const AT = '2026-09-10T00:00:00.000Z'

// The registry is empty today and that is correct: the schema is still at version 1 and nothing has
// broken. The mechanism is exercised against a fixture written under a pretend version 0, because
// the day a real upcaster is needed the old rows already exist and it is too late to add the seam.
const RENAMED: Upcaster = {
  kind: 'state_change',
  from: 0,
  to: 1,
  upcast: (payload) => {
    const old = payload as { change: string; why?: string }
    return old.change === 'session_closed' ? { change: 'session_closed', reason: old.why } : old
  },
}

function writtenAtVersion(version: number, payload: unknown) {
  return {
    eventId: 'evt_0',
    sessionId: 'ses_1',
    seq: 0,
    occurredAt: AT,
    schemaVersion: version,
    kind: 'state_change',
    payload,
  }
}

test('the shipped registry is empty, because nothing has broken yet', () => {
  expect(UPCASTERS).toEqual([])
  expect(EVENT_SCHEMA_VERSION).toBe(1)
})

test('an event already at the current version is returned untouched', () => {
  const current = writtenAtVersion(1, { change: 'session_closed', reason: 'turns' })

  expect(upcastEvent(current, [RENAMED])).toBe(current)
})

// The point of the seam: a row written under the old shape still folds into a view.
test('a fixture written under an older version reads, and replays', () => {
  const old = writtenAtVersion(0, { change: 'session_closed', why: 'turns' })

  const event = readEvent(old, 'fixture', [RENAMED])
  expect(event.schemaVersion).toBe(1)
  expect(replay([event]).closed).toEqual({ reason: 'turns' })
})

test('a missing upcaster is a named failure, never a silently skipped row', () => {
  const old = writtenAtVersion(0, { change: 'session_closed', why: 'turns' })

  expect(() => upcastEvent(old, [])).toThrow(UpcastGap)
  expect(() => upcastEvent(old, [])).toThrow(/append-only log cannot be rewritten/)
})

test('upcasters chain one step at a time, so each knows only its own step', () => {
  const zeroToOne: Upcaster = {
    kind: 'state_change',
    from: 0,
    to: 1,
    upcast: (payload) => ({ ...(payload as object), stage: 'one' }),
  }
  const oneToTwo: Upcaster = {
    kind: 'state_change',
    from: 1,
    to: 2,
    upcast: (payload) => ({ ...(payload as object), stage: 'two' }),
  }

  const upcast = upcastEvent(
    writtenAtVersion(0, { change: 'session_closed', reason: 'turns' }),
    [zeroToOne, oneToTwo],
    2,
  ) as { schemaVersion: number; payload: { stage: string } }

  expect(upcast.schemaVersion).toBe(2)
  expect(upcast.payload.stage).toBe('two')
})

// Validating before upcasting would reject every old row on the way in and make the upcaster
// unreachable — which is the failure this ordering exists to prevent.
test('an old row that no upcaster can fix still fails validation, not silently', () => {
  expect(() => readEvent(writtenAtVersion(1, { change: 'not_a_change' }), 'fixture')).toThrow(
    /not a valid event/,
  )
})
