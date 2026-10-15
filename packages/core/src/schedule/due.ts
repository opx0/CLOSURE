import type { GapEntry } from '@levelhead/contracts'
import { nextReviewAt, reviewCountAfter } from './spacing.ts'

// Read off the ledger's recorded attempts rather than off a field invented for the schedule.
export function retrievalCountOf(gap: GapEntry): number {
  // Survived retrievals, not attempts — a lapse does not advance the schedule.
  const recorded = (gap.retrievals ?? []).filter((retrieval) => retrieval.passed).length
  // Not currently closed means the last attempt failed, so it comes back one rung narrower.
  return gap.status === 'closed_under_transfer' ? recorded : reviewCountAfter(recorded, false)
}

// Derived entirely from the row, so the same gaps and the same `now` always select the same
// questions — what makes a session replayable.
export function reviewDueAt(gap: GapEntry): string {
  return nextReviewAt(gap, retrievalCountOf(gap), gap.lastTouchedAt)
}

export function isDue(gap: GapEntry, now: string): boolean {
  // A gap that is still open is drilled, not retrieved (§4.5's steps run in order).
  if (gap.status !== 'closed_under_transfer') return false
  return Date.parse(now) >= Date.parse(reviewDueAt(gap))
}

function overdueMs(gap: GapEntry, now: string): number {
  return Date.parse(now) - Date.parse(reviewDueAt(gap))
}

// No flag, no reason, no "review" marker — these must arrive unannounced, as ordinary interview
// questions (§4.5): a visible retrieval cue changes what's measured from recall to recognition.
export function dueForRetrieval(gaps: readonly GapEntry[], now: string, limit: number): GapEntry[] {
  if (limit <= 0) return []

  return gaps
    .filter((gap) => isDue(gap, now))
    .sort((left, right) => {
      // Most overdue first; id breaks ties so same-day gaps never depend on ledger order.
      const gap = overdueMs(right, now) - overdueMs(left, now)
      return gap !== 0 ? gap : left.id.localeCompare(right.id)
    })
    .slice(0, Math.trunc(limit))
}
