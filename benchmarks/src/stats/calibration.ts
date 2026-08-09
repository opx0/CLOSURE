// Calibration of the evaluator's own confidence against human labels. Ticket 05 §5 thresholds the
// reliability component (≤ 0.10 self-use, ≤ 0.05 flagship with resolution > 0); the reliability
// diagram must ship with raw per-bin counts, which is why `bins` carries `count` and not just a rate.
//
// There is deliberately no ECE here — adding it back as a convenience would undo a decision, not add
// a feature. ECE is a biased estimator that worsens as per-bin n shrinks (directly the n = 30-50 case
// here) and isn't a proper scoring rule, so a model predicting the base rate and discriminating
// nothing can minimise it (Research §2). Brier is strictly proper and can't be gamed that way.

export type Forecast = { p: number; outcome: 0 | 1 }

export type ReliabilityBin = {
  from: number
  to: number
  count: number
  meanForecast: number
  observedRate: number
}

export type BrierDecomposition = {
  brier: number
  reliability: number
  resolution: number
  uncertainty: number
  bins: ReliabilityBin[]
}

export const DEFAULT_BINS = 10

export function brierDecomposed(
  forecasts: readonly Forecast[],
  bins: number = DEFAULT_BINS,
): BrierDecomposition {
  if (!Number.isInteger(bins) || bins < 1) {
    throw new RangeError(`bins must be a positive integer, got ${bins}`)
  }
  for (const { p, outcome } of forecasts) {
    if (!(Number.isFinite(p) && p >= 0 && p <= 1)) {
      throw new RangeError(`forecast p must be in [0, 1], got ${p}`)
    }
    if (outcome !== 0 && outcome !== 1) {
      throw new RangeError(`outcome must be 0 or 1, got ${String(outcome)}`)
    }
  }

  const edges = Array.from({ length: bins + 1 }, (_, k) => k / bins)
  // Compares against edges rather than floor(p * bins) — floor(p * bins) has float artefacts, e.g.
  // 0.29 * 100 landing one bin low.
  const binOf = (p: number): number => {
    for (let k = 0; k < bins - 1; k += 1) {
      if (p < (edges[k + 1] as number)) return k
    }
    return bins - 1
  }

  const counts = new Float64Array(bins)
  const forecastSum = new Float64Array(bins)
  const outcomeSum = new Float64Array(bins)
  let brierSum = 0
  let outcomeTotal = 0
  for (const { p, outcome } of forecasts) {
    const k = binOf(p)
    counts[k] = (counts[k] ?? 0) + 1
    forecastSum[k] = (forecastSum[k] ?? 0) + p
    outcomeSum[k] = (outcomeSum[k] ?? 0) + outcome
    brierSum += (p - outcome) * (p - outcome)
    outcomeTotal += outcome
  }

  const n = forecasts.length
  const baseRate = n === 0 ? NaN : outcomeTotal / n
  const reported: ReliabilityBin[] = []
  let reliability = 0
  let resolution = 0
  for (let k = 0; k < bins; k += 1) {
    const count = counts[k] ?? 0
    // Empty bins stay in the output — a range with no forecasts is itself a finding, not padding to
    // drop.
    const meanForecast = count === 0 ? NaN : (forecastSum[k] ?? 0) / count
    const observedRate = count === 0 ? NaN : (outcomeSum[k] ?? 0) / count
    reported.push({
      from: edges[k] as number,
      to: edges[k + 1] as number,
      count,
      meanForecast,
      observedRate,
    })
    if (count === 0) continue
    reliability += count * (meanForecast - observedRate) ** 2
    resolution += count * (observedRate - baseRate) ** 2
  }

  if (n === 0) {
    return { brier: NaN, reliability: NaN, resolution: NaN, uncertainty: NaN, bins: reported }
  }

  // Murphy (1973): brier = reliability - resolution + uncertainty (note the sign). Exact only when
  // every forecast in a bin is identical, since binning by range hides a within-bin scatter term —
  // `brier` is computed directly from the items rather than reconstructed, and the gap between the
  // two is the diagnostic for a bin count too coarse for what it's summarising.
  return {
    brier: brierSum / n,
    reliability: reliability / n,
    resolution: resolution / n,
    uncertainty: baseRate * (1 - baseRate),
    bins: reported,
  }
}
