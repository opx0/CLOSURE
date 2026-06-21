import { test, expect } from 'bun:test'
import type { GapEntry } from '@closer/contracts'
import type { Clock } from '../ports/clock.ts'
import { isDue, reviewDueAt } from './due.ts'
import { applyRetrievalResult } from './outcome.ts'

const clock: Clock = { now: () => '2026-09-05T00:00:00.000Z' }

function gapOf(over: Partial<GapEntry> = {}): GapEntry {
  return {
    id: 'gap-1',
    competency: 'failure_modes',
    claimId: 'claim-1',
    summary: 'Double completion after worker resurrection',
    status: 'closed_under_transfer',
    findingIds: ['finding-1'],
    evidenceIds: ['evidence-1'],
    openedAt: '2026-08-01T00:00:00.000Z',
    lastTouchedAt: '2026-09-01T00:00:00.000Z',
    transferAttemptIds: ['transfer-1'],
    retrievals: [],
    ...over,
  }
}

test('a survived retrieval keeps the gap closed and widens its next interval', () => {
  const before = gapOf()
  const { gap, transition } = applyRetrievalResult(before, 'retrieval-1', true, { clock })

  expect(gap.status).toBe('closed_under_transfer')
  expect(transition).toBeNull()
  expect(gap.transferAttemptIds).toEqual(['transfer-1', 'retrieval-1'])
  expect(gap.lastTouchedAt).toBe('2026-09-05T00:00:00.000Z')
  // Owed a retrieval a day after last touch; having survived one, it's owed several days further out.
  expect(Date.parse(reviewDueAt(gap))).toBeGreaterThan(
    Date.parse(reviewDueAt(before)) + 3 * 86_400_000,
  )
})

test('a failed retrieval reopens the gap and records the transition', () => {
  const before = gapOf({ transferAttemptIds: ['transfer-1', 'retrieval-1'] })
  const { gap, transition } = applyRetrievalResult(before, 'retrieval-2', false, { clock })

  expect(gap.status).toBe('open')
  expect(transition).toEqual({ gapId: 'gap-1', from: 'closed_under_transfer', to: 'open' })
  // Reopened means back to the drill, not back on the schedule.
  expect(isDue(gap, '2027-01-01T00:00:00.000Z')).toBe(false)
  expect(gap.transferAttemptIds).toEqual(['transfer-1', 'retrieval-1', 'retrieval-2'])
})

test('a retrieval never closes a gap that has not held under transfer', () => {
  for (const status of ['open', 'drilled', 'unverified'] as const) {
    const before = gapOf({ status, transferAttemptIds: [] })
    const { gap, transition } = applyRetrievalResult(before, 'retrieval-1', true, { clock })

    expect(gap).toBe(before)
    expect(transition).toBeNull()
  }
})

test('the same attempt applied twice is recorded once', () => {
  const first = applyRetrievalResult(gapOf(), 'retrieval-1', true, { clock }).gap
  const second = applyRetrievalResult(first, 'retrieval-1', true, { clock }).gap

  expect(second.transferAttemptIds).toEqual(['transfer-1', 'retrieval-1'])
})

test('the gap it was given is left alone', () => {
  const before = gapOf()
  const snapshot = structuredClone(before)

  applyRetrievalResult(before, 'retrieval-1', false, { clock })

  expect(before).toEqual(snapshot)
})
