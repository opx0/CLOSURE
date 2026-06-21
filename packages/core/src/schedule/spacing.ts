import type { GapEntry } from '@closer/contracts'

// A table anyone can read and argue with, not an invented decay formula (§4.5 step 3, §15). Roughly
// doubling, ending at a rung the row repeats forever — a gap is never "done". Chosen starting point,
// not a finding; a real usage record should replace these.
export const INTERVALS: readonly number[] = [1, 3, 7, 14, 30, 60]

const WIDEST = INTERVALS[INTERVALS.length - 1] ?? 1

const DAY_MS = 86_400_000

export function intervalDays(reviewCount: number): number {
  const rung = Math.min(Math.max(Math.trunc(reviewCount), 0), INTERVALS.length - 1)
  return INTERVALS[rung] ?? WIDEST
}

// One rung back on a failure, not to zero — the failure also reopens the row (outcome.ts), which is
// already the strongest correction the ledger has.
export function reviewCountAfter(reviewCount: number, passed: boolean): number {
  const current = Math.max(Math.trunc(reviewCount), 0)
  return passed ? current + 1 : Math.max(0, current - 1)
}

export function nextReviewAt(gap: GapEntry, reviewCount: number, now: string): string {
  // Anchored on the later of the two: a review can never be due before the movement that scheduled
  // it, and replay can hand this a `now` that precedes the row's own last touch.
  const anchor = Math.max(Date.parse(now), Date.parse(gap.lastTouchedAt))
  return new Date(anchor + intervalDays(reviewCount) * DAY_MS).toISOString()
}
