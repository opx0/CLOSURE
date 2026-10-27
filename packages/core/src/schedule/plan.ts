import { ROUND_ORDER, type GapEntry, type RoundKind } from '@levelhead/contracts'
import { ROUND_ARCS } from '../policy/rounds.ts'
import { AREA_ROUND, topicById } from '../topics/index.ts'
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

// A gap is practised where the thing it is about gets asked: a topic in its own round, composure
// in the behavioral round, and anything from the résumé in the rounds that cross-question it on
// that competency. A competency gap with neither a topic nor a claim was opened on the résumé side.
function roundsFor(gap: GapEntry): RoundKind[] {
  if (gap.topicId !== undefined) {
    const topic = topicById(gap.topicId)
    return topic === undefined ? [] : [AREA_ROUND[topic.area]]
  }
  if (gap.competency === 'composure') return ['behavioral']
  return ROUND_ORDER.filter(
    (round) =>
      ROUND_ARCS[round].subject === 'claim' && ROUND_ARCS[round].arc.includes(gap.competency),
  )
}

function suggestRounds(gaps: readonly GapEntry[]): RoundKind[] {
  const suggested = new Set(gaps.flatMap(roundsFor))
  return ROUND_ORDER.filter((round) => suggested.has(round))
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
    .sort((left, right) => {
      const leftDue = isDue(left.gap, input.now)
      const rightDue = isDue(right.gap, input.now)
      if (leftDue !== rightDue) return leftDue ? -1 : 1
      const leftFuture = left.gap.status === 'closed_under_transfer'
      const rightFuture = right.gap.status === 'closed_under_transfer'
      if (leftFuture !== rightFuture) return leftFuture ? 1 : -1
      return (
        Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.gap.id.localeCompare(right.gap.id)
      )
    })

  return {
    suggestedRounds: suggestRounds(work.map((entry) => entry.gap)),
    work,
    retrievals: dueForRetrieval(input.gaps, input.now, input.retrievalLimit),
    nothingDue: work.every(
      (entry) => entry.gap.status === 'closed_under_transfer' && !isDue(entry.gap, input.now),
    ),
    horizonEndsAt,
  }
}
