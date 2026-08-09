// Ticket 05 §5: every judgment metric is gated on a percentile bootstrap interval's lower bound. §7
// publishes every run, so a benchmark whose numbers move between runs of the same data is not
// auditable — Math.random is banned in this file, and the seed is required, not defaulted, so the
// caller must name the stream it draws from.

export type BootstrapOptions = {
  resamples?: number
  alpha?: number
  seed: number
}

export type BootstrapInterval = {
  point: number
  lower: number
  upper: number
  // Not necessarily opts.resamples — a replicate whose statistic is undefined (no variance in the
  // resample, say) is dropped rather than counted, since a coefficient nobody could compute is not
  // evidence.
  resamples: number
}

export const DEFAULT_RESAMPLES = 2000
export const DEFAULT_ALPHA = 0.05

// mulberry32: short enough to read in full. The only property this needs is that the same seed
// replays the same stream on any engine, which integer ops + Math.imul guarantee.
export function seededRng(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
}

// Dividing a uint32 by 2^32 is exact in IEEE754, so the index is a pure function of the state.
const indexBelow = (rng: () => number, n: number): number => Math.floor((rng() / 0x100000000) * n)

// Type-7 (linear interpolation) quantile, the R default — any convention would do, but naming one
// and keeping it fixed is what stops the interval from drifting if this gets rewritten.
const quantile = (sorted: readonly number[], p: number): number => {
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const at = sorted[lo] ?? NaN
  const next = sorted[Math.min(lo + 1, sorted.length - 1)] ?? NaN
  return at + (h - lo) * (next - at)
}

export function bootstrapCiOf<T>(
  items: readonly T[],
  statistic: (sample: readonly T[]) => number,
  opts: BootstrapOptions,
): BootstrapInterval {
  const requested = opts.resamples ?? DEFAULT_RESAMPLES
  const alpha = opts.alpha ?? DEFAULT_ALPHA
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError(`resamples must be a positive integer, got ${requested}`)
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must be in (0, 1), got ${alpha}`)
  }
  if (!Number.isInteger(opts.seed)) {
    throw new RangeError(`seed must be an integer, got ${opts.seed}`)
  }

  const n = items.length
  if (n === 0) return { point: NaN, lower: NaN, upper: NaN, resamples: 0 }

  const rng = seededRng(opts.seed)
  const replicates: number[] = []
  for (let b = 0; b < requested; b += 1) {
    // Fresh array per replicate — a statistic that keeps a reference to its argument must not see
    // the next resample appear underneath it.
    const sample = new Array<T>(n)
    for (let i = 0; i < n; i += 1) {
      sample[i] = items[indexBelow(rng, n)] as T
    }
    const value = statistic(sample)
    if (Number.isFinite(value)) replicates.push(value)
  }
  replicates.sort((a, b) => a - b)

  const point = statistic(items)
  if (replicates.length === 0) return { point, lower: NaN, upper: NaN, resamples: 0 }

  // Not an asymptotic Wald interval (point ± z·SE): at n = 30-50, and near a coefficient's 1.0
  // boundary, the normal approximation gives intervals that are too narrow and can cover impossible
  // values — wrong in the optimistic direction, which is exactly the failure this layer exists to
  // prevent (§5).
  return {
    point,
    lower: quantile(replicates, alpha / 2),
    upper: quantile(replicates, 1 - alpha / 2),
    resamples: replicates.length,
  }
}

export function bootstrapCi(
  values: readonly number[],
  statistic: (sample: readonly number[]) => number,
  opts: BootstrapOptions,
): BootstrapInterval {
  return bootstrapCiOf(values, statistic, opts)
}
