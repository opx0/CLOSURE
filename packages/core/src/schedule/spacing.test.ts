import { test, expect } from 'bun:test'
import type { GapEntry } from '@levelhead/contracts'
import { INTERVALS, intervalDays, nextReviewAt, reviewCountAfter } from './spacing.ts'

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
    transferAttemptIds: ['attempt-1'],
    retrievals: [],
    ...over,
  }
}

test('the table widens at every rung', () => {
  for (let rung = 1; rung < INTERVALS.length; rung += 1) {
    expect(intervalDays(rung)).toBeGreaterThan(intervalDays(rung - 1))
  }
})

test('a count past the table repeats the widest rung rather than growing forever', () => {
  const widest = intervalDays(INTERVALS.length - 1)
  expect(intervalDays(INTERVALS.length)).toBe(widest)
  expect(intervalDays(1000)).toBe(widest)
  expect(intervalDays(-3)).toBe(intervalDays(0))
})

test('each survived retrieval schedules the next one further out', () => {
  const gap = gapOf()
  const now = '2026-09-01T00:00:00.000Z'

  const schedule = INTERVALS.map((_, rung) => Date.parse(nextReviewAt(gap, rung, now)))
  const widening = schedule.every(
    (at, rung) => rung === 0 || at > (schedule[rung - 1] ?? Number.POSITIVE_INFINITY),
  )

  expect(widening).toBe(true)
  expect(nextReviewAt(gap, 0, now)).toBe('2026-09-02T00:00:00.000Z')
  expect(nextReviewAt(gap, 2, now)).toBe('2026-09-08T00:00:00.000Z')
})

test('a survived retrieval widens the count and a failed one contracts it', () => {
  expect(reviewCountAfter(2, true)).toBe(3)
  expect(reviewCountAfter(2, false)).toBe(1)
  expect(reviewCountAfter(0, false)).toBe(0)
})

test('a failed retrieval schedules the next one sooner than a survived one would', () => {
  const gap = gapOf()
  const now = '2026-09-01T00:00:00.000Z'

  const afterFailure = nextReviewAt(gap, reviewCountAfter(3, false), now)
  const afterSuccess = nextReviewAt(gap, reviewCountAfter(3, true), now)

  expect(Date.parse(afterFailure)).toBeLessThan(Date.parse(afterSuccess))
  expect(Date.parse(afterFailure)).toBeLessThan(Date.parse(nextReviewAt(gap, 3, now)))
})

test('a review is never scheduled before the movement that scheduled it', () => {
  const gap = gapOf({ lastTouchedAt: '2026-09-10T00:00:00.000Z' })

  expect(nextReviewAt(gap, 0, '2026-09-01T00:00:00.000Z')).toBe('2026-09-11T00:00:00.000Z')
})

test('the schedule is a pure function of its arguments', () => {
  const gap = gapOf()
  const first = nextReviewAt(gap, 2, '2026-09-01T00:00:00.000Z')
  const second = nextReviewAt(gap, 2, '2026-09-01T00:00:00.000Z')

  expect(second).toBe(first)
  expect(gap).toEqual(gapOf())
})
