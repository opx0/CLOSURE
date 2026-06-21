import type { GapEntry, RoundKind } from '@closer/contracts'
import { dueForRetrieval, isDue, reviewDueAt } from './due.ts'

export interface PlannedWork {
  gap: GapEntry
  reason:
    | 'drill_the_open_gap'
    | 'transfer_the_drilled_gap'
    | 'retrieve_the_closed_gap'
    | 'restate_the_unverified'
  dueAt: string
}

export interface SessionPlan {
  suggestedRounds: RoundKind[]
  work: PlannedWork[]
  retrievals: GapEntry[]
  nothingDue: boolean
  horizonEndsAt: string
}

const DAY_MS = 86_400_000

function reasonFor(gap: GapEntry): PlannedWork['reason'] {
  switch (gap.status) {
    case 'open':
      return 'drill_the_open_gap'
    case 'drilled':
      return 'transfer_the_drilled_gap'
    case 'unverified':
      return 'restate_the_unverified'
    case 'closed_under_transfer':
      return 'retrieve_the_closed_gap'
  }
}

function dueAtFor(gap: GapEntry): string {
  return gap.status === 'closed_under_transfer' ? reviewDueAt(gap) : gap.lastTouchedAt
}

export function planNextSession(input: {
  gaps: readonly GapEntry[]
  now: string
  horizonDays: number
  retrievalLimit: number
}): SessionPlan {
  const horizonEndsAt = new Date(Date.parse(input.now) + input.horizonDays * DAY_MS).toISOString()

  const work = input.gaps
    .filter(
      (gap) =>
        gap.status !== 'closed_under_transfer' ||
        Date.parse(reviewDueAt(gap)) <= Date.parse(horizonEndsAt),
    )
    .map((gap) => ({ gap, reason: reasonFor(gap), dueAt: dueAtFor(gap) }))
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))

  const competencies = new Set(work.map((entry) => entry.gap.competency))
  const suggestedRounds: RoundKind[] = ['project_deep_dive']
  if (competencies.has('trade_offs') || competencies.has('failure_modes')) {
    suggestedRounds.push('design_extension')
  }
  if (competencies.has('composure')) suggestedRounds.push('behavioral')

  return {
    suggestedRounds,
    work,
    retrievals: dueForRetrieval(input.gaps, input.now, input.retrievalLimit),
    nothingDue: work.every(
      (entry) => entry.gap.status === 'closed_under_transfer' && !isDue(entry.gap, input.now),
    ),
    horizonEndsAt,
  }
}
