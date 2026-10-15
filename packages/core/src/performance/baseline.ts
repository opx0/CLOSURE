import type { PerformanceBaseline, PerformanceObservation, SignalId } from '@levelhead/contracts'

// One past observation with the instant it was taken. The instant is a string so the caller's own
// timestamps survive round trips; comparisons parse it rather than sorting the spelling.
export interface TimestampedObservation {
  readonly observation: PerformanceObservation
  readonly at: string
}

// Type-7 linear interpolation on n - 1, the default of R and NumPy. Assumes a sorted, non-empty
// input, because every caller here already has one. The choice is visible because small-n
// percentiles differ by method, and a baseline that changed shape when the estimator changed would
// not be auditable.
export function quantile(sorted: readonly number[], q: number): number {
  const position = q * (sorted.length - 1)
  const low = Math.floor(position)
  const high = Math.ceil(position)
  const lowValue = sorted[low]
  const highValue = sorted[high]
  if (lowValue === undefined || highValue === undefined) {
    throw new Error('quantile of an empty series')
  }
  if (low === high) return lowValue
  return lowValue + (position - low) * (highValue - lowValue)
}

export function medianOf(values: readonly number[]): number {
  return quantile(
    [...values].sort((left, right) => left - right),
    0.5,
  )
}

// Grouped in first-appearance order so a caller reading the list back can predict it. A signal with
// no history yields no baseline at all: the honest first-session answer is silence, not an empty band.
export function baselinesFrom(history: readonly TimestampedObservation[]): PerformanceBaseline[] {
  const bySignal = new Map<SignalId, TimestampedObservation[]>()
  for (const row of history) {
    const signal = row.observation.signal
    const existing = bySignal.get(signal)
    if (existing === undefined) bySignal.set(signal, [row])
    else existing.push(row)
  }

  const baselines: PerformanceBaseline[] = []
  for (const [signal, rows] of bySignal) {
    const sorted = rows.map((row) => row.observation.value).sort((left, right) => left - right)
    let earliest = rows[0]
    let latest = rows[0]
    if (earliest === undefined || latest === undefined) continue
    for (const row of rows) {
      if (Date.parse(row.at) < Date.parse(earliest.at)) earliest = row
      if (Date.parse(row.at) > Date.parse(latest.at)) latest = row
    }
    baselines.push({
      signal,
      n: rows.length,
      median: quantile(sorted, 0.5),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      earliestAt: earliest.at,
      latestAt: latest.at,
    })
  }
  return baselines
}
