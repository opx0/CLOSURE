import { test, expect } from 'bun:test'
import { GapEntrySchema, type GapEntry, type GapStatus } from '@closer/contracts'
import { dueForRetrieval, isDue, retrievalCountOf, reviewDueAt } from './due.ts'

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

const survived = (n: number) =>
  Array.from({ length: n }, (_, at) => ({
    attemptId: `retrieval-${at + 1}`,
    at: '2026-09-01T00:00:00.000Z',
    passed: true,
  }))

test('only retrievals that were survived advance the schedule', () => {
  expect(retrievalCountOf(gapOf({ retrievals: [] }))).toBe(0)
  expect(retrievalCountOf(gapOf({ retrievals: survived(1) }))).toBe(1)

  // A lapse is recorded and does not count — counting attempts would overstate the evidence.
  const lapsed = [
    ...survived(1),
    { attemptId: 'retrieval-2', at: '2026-09-08T00:00:00.000Z', passed: false },
  ]
  expect(retrievalCountOf(gapOf({ retrievals: lapsed }))).toBe(1)
})

test('a reopened row comes back one rung narrower', () => {
  expect(retrievalCountOf(gapOf({ retrievals: survived(2) }))).toBe(2)
  expect(retrievalCountOf(gapOf({ status: 'open', retrievals: survived(2) }))).toBe(1)
})

test('only a gap that held under transfer is ever due', () => {
  const stale = '2027-01-01T00:00:00.000Z'
  const unclosed: GapStatus[] = ['open', 'drilled', 'unverified']

  for (const status of unclosed) {
    expect(isDue(gapOf({ status }), stale)).toBe(false)
  }
  expect(isDue(gapOf(), stale)).toBe(true)
  expect(
    dueForRetrieval(
      unclosed.map((status) => gapOf({ status })),
      stale,
      10,
    ),
  ).toEqual([])
})

test('a gap is due from its scheduled instant, not before it', () => {
  const gap = gapOf()

  expect(reviewDueAt(gap)).toBe('2026-09-02T00:00:00.000Z')
  expect(isDue(gap, '2026-09-01T23:59:59.999Z')).toBe(false)
  expect(isDue(gap, '2026-09-02T00:00:00.000Z')).toBe(true)
})

test('a gap that has survived more retrievals stays quiet longer', () => {
  const fresh = gapOf({ retrievals: [] })
  const seasoned = gapOf({ retrievals: survived(2) })

  expect(Date.parse(reviewDueAt(seasoned))).toBeGreaterThan(Date.parse(reviewDueAt(fresh)))
  expect(isDue(fresh, '2026-09-03T00:00:00.000Z')).toBe(true)
  expect(isDue(seasoned, '2026-09-03T00:00:00.000Z')).toBe(false)
})

test('selection is ordered by how overdue a gap is, ties broken by id', () => {
  const now = '2026-09-05T00:00:00.000Z'
  const ancient = gapOf({ id: 'gap-9', lastTouchedAt: '2026-08-01T00:00:00.000Z' })
  const tiedB = gapOf({ id: 'gap-b' })
  const tiedA = gapOf({ id: 'gap-a' })

  expect(dueForRetrieval([tiedB, ancient, tiedA], now, 10).map((gap) => gap.id)).toEqual([
    'gap-9',
    'gap-a',
    'gap-b',
  ])
  expect(dueForRetrieval([tiedA, tiedB, ancient], now, 10).map((gap) => gap.id)).toEqual([
    'gap-9',
    'gap-a',
    'gap-b',
  ])
})

test('selection respects the limit and asks for nothing when there is no room', () => {
  const now = '2026-09-05T00:00:00.000Z'
  const gaps = [gapOf({ id: 'gap-a' }), gapOf({ id: 'gap-b' }), gapOf({ id: 'gap-c' })]

  expect(dueForRetrieval(gaps, now, 2).map((gap) => gap.id)).toEqual(['gap-a', 'gap-b'])
  expect(dueForRetrieval(gaps, now, 0)).toEqual([])
  expect(dueForRetrieval(gaps, now, -1)).toEqual([])
})

test('nothing in what is returned marks the question as a review', () => {
  const gap = gapOf()
  const [selected] = dueForRetrieval([gap], '2026-09-05T00:00:00.000Z', 1)

  // Same object, same keys as the contract — no flag for a renderer to leak (§4.5).
  expect(selected).toBe(gap)
  expect(Object.keys(selected ?? {}).sort()).toEqual(Object.keys(GapEntrySchema.properties).sort())
})

test('selection is pure: same gaps and same now, same answer, inputs untouched', () => {
  const now = '2026-09-05T00:00:00.000Z'
  const gaps = [gapOf({ id: 'gap-b' }), gapOf({ id: 'gap-a', status: 'open' })]
  const before = structuredClone(gaps)

  const first = dueForRetrieval(gaps, now, 10)
  const second = dueForRetrieval(gaps, now, 10)

  expect(second).toEqual(first)
  expect(gaps).toEqual(before)
  expect(gaps.map((gap) => gap.id)).toEqual(['gap-b', 'gap-a'])
})
