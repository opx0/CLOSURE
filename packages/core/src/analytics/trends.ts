import {
  PERFORMANCE_BOUNDARY,
  SIGNAL_IDS,
  type PerformanceObservation,
  type PerformanceTrend,
  type TrendPoint,
} from '@levelhead/contracts'

// The longitudinal half of the performance lane, and it may name no type from the judged lane. Its
// counterpart is `competence-trends.ts`; `wall.test.ts` greps both.

export interface PerformanceSession {
  readonly sessionId: string
  readonly at: string
  readonly observations: readonly PerformanceObservation[]
}

// Median, not mean, because a baseline reports median/p25/p75 — a trend point and a baseline median
// are then the same kind of number and can share one axis.
function medianOf(values: readonly number[]): number | null {
  const sorted = [...values].sort((left, right) => left - right)
  // The two middle values, which are the same element when the run has an odd length.
  const upper = sorted[sorted.length >> 1]
  if (upper === undefined) return null
  const lower = sorted[(sorted.length - 1) >> 1] ?? upper
  return (lower + upper) / 2
}

export function performanceTrends(history: readonly PerformanceSession[]): PerformanceTrend[] {
  const ordered = [...history].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))

  const trends: PerformanceTrend[] = []
  // Registry order, so every surface that draws these lists them the same way.
  for (const signal of SIGNAL_IDS) {
    const points: TrendPoint[] = []
    for (const session of ordered) {
      const value = medianOf(
        session.observations
          .filter((observation) => observation.signal === signal)
          .map((observation) => observation.value),
      )
      // A session that did not measure this signal gets no point. Carrying the previous value
      // forward would draw a flat line nobody recorded.
      if (value !== null) points.push({ at: session.at, sessionId: session.sessionId, value })
    }
    if (points.length > 0) trends.push({ signal, points, boundary: PERFORMANCE_BOUNDARY })
  }
  return trends
}
