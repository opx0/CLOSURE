// Model-human and human-human agreement. Kappa (plain/weighted/Fleiss) is ruled out: under this
// rubric's skewed marginals, chance-correction can swing kappa from 0.90 to -0.02 at ~95% observed
// agreement (Research §1) — Krippendorff's ordinal alpha is the headline stat instead, with Gwet's
// AC2 as the named alternative for the same skew.
//
// No threshold is applied here, nor should a caller apply one to a point estimate — gates live in
// bootstrap.ts (ticket 05 §5, 0.40 self-use / 0.60 flagship, no verdict below n = 100). Those are
// this project's own choices; Landis & Koch's "moderate"/"substantial" bands are not authority here
// — their own authors called the divisions "clearly arbitrary" and meant them for one worked example.

// Units x raters. `null` is a missing rating, not a category.
export type Ratings = readonly (readonly (number | null)[])[]

// Weight is by category *value*, not index — a caller never has to reconstruct the internal
// category ordering to supply one.
export type AgreementWeights = (a: number, b: number) => number

const at = (v: Float64Array, i: number): number => v[i] ?? 0

// Non-finite ratings are treated as missing — a stray NaN would poison every distance computed
// against it.
const pairableUnits = (ratings: Ratings): number[][] =>
  ratings
    .map((unit) => unit.filter((v): v is number => v !== null && Number.isFinite(v)))
    .filter((unit) => unit.length >= 2)

const categoriesOf = (units: readonly (readonly number[])[]): number[] =>
  [...new Set(units.flat())].sort((a, b) => a - b)

const countsFor = (unit: readonly number[], index: ReadonlyMap<number, number>): Float64Array => {
  const counts = new Float64Array(index.size)
  for (const value of unit) {
    const i = index.get(value) ?? 0
    counts[i] = at(counts, i) + 1
  }
  return counts
}

export function krippendorffOrdinalAlpha(ratings: Ratings): number {
  const units = pairableUnits(ratings)
  // Fewer than two pairable units isn't a small sample, it's a different quantity — alpha would
  // measure the one unit against itself, so this returns NaN rather than a number.
  if (units.length < 2) return NaN

  const categories = categoriesOf(units)
  const q = categories.length
  const index = new Map(categories.map((c, i) => [c, i]))

  // Coincidence-matrix marginals reduce to per-unit value counts, so the matrix itself is never
  // built.
  const marginal = new Float64Array(q)
  const perUnit = units.map((unit) => countsFor(unit, index))
  for (const counts of perUnit) {
    for (let c = 0; c < q; c += 1) marginal[c] = at(marginal, c) + at(counts, c)
  }

  const n = marginal.reduce((sum, value) => sum + value, 0)
  if (n < 2) return NaN

  // delta2: mass spanned between two categories, less half the mass at each endpoint. Restricting
  // the category set to observed values is exact, not an approximation — an unobserved intermediate
  // level has n_g = 0 and adds nothing to the span.
  const prefix = new Float64Array(q + 1)
  for (let c = 0; c < q; c += 1) prefix[c + 1] = at(prefix, c) + at(marginal, c)
  const delta2 = (a: number, b: number): number => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const span = at(prefix, hi + 1) - at(prefix, lo)
    const d = span - (at(marginal, lo) + at(marginal, hi)) / 2
    return d * d
  }

  let observed = 0
  for (let u = 0; u < perUnit.length; u += 1) {
    const counts = perUnit[u] as Float64Array
    const m = (units[u] as number[]).length
    for (let c = 0; c < q; c += 1) {
      for (let k = 0; k < q; k += 1) {
        const pairs = at(counts, c) * (at(counts, k) - (c === k ? 1 : 0))
        if (pairs !== 0) observed += (pairs * delta2(c, k)) / (m - 1)
      }
    }
  }

  let expected = 0
  for (let c = 0; c < q; c += 1) {
    for (let k = 0; k < q; k += 1) {
      expected += at(marginal, c) * at(marginal, k) * delta2(c, k)
    }
  }
  // Every rating in one category leaves no disagreement to have had, so there's no chance agreement
  // to correct against — 1 - 0/0 is not "perfect agreement", it is unanswerable.
  if (expected === 0) return NaN

  return 1 - ((n - 1) * observed) / expected
}

// Gwet's ordinal weights: 1 - C(d + 1, 2) / C(q, 2) for categories d apart — identical weighs 1, the
// two extremes weigh 0.
const gwetOrdinalWeights = (categories: readonly number[]): AgreementWeights => {
  const rank = new Map(categories.map((c, i) => [c, i]))
  const q = categories.length
  const maxPairs = (q * (q - 1)) / 2
  return (a, b) => {
    const d = Math.abs((rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    return 1 - ((d + 1) * d) / 2 / maxPairs
  }
}

export function gwetAc2(ratings: Ratings, weights?: AgreementWeights): number {
  const units = pairableUnits(ratings)
  if (units.length < 2) return NaN

  const categories = categoriesOf(units)
  const q = categories.length
  // With a single observed category there's nothing to disagree about — undefined, not 1.
  if (q < 2) return NaN

  const index = new Map(categories.map((c, i) => [c, i]))
  const weightOf = weights ?? gwetOrdinalWeights(categories)
  const w = new Float64Array(q * q)
  let totalWeight = 0
  for (let k = 0; k < q; k += 1) {
    for (let l = 0; l < q; l += 1) {
      const value = weightOf(categories[k] as number, categories[l] as number)
      w[k * q + l] = value
      totalWeight += value
    }
  }

  // pa is averaged per unit, not per rating: the mean over units of the weighted probability that
  // two raters drawn without replacement from that unit agree — a unit with two raters counts the
  // same as one with ten.
  let agreement = 0
  const pi = new Float64Array(q)
  for (const unit of units) {
    const counts = countsFor(unit, index)
    const raters = unit.length
    for (let k = 0; k < q; k += 1) {
      let weighted = 0
      for (let l = 0; l < q; l += 1) weighted += at(w, k * q + l) * at(counts, l)
      agreement += (at(counts, k) * (weighted - 1)) / (raters * (raters - 1))
      pi[k] = at(pi, k) + at(counts, k) / raters
    }
  }
  const pa = agreement / units.length

  let spread = 0
  for (let k = 0; k < q; k += 1) {
    const share = at(pi, k) / units.length
    spread += share * (1 - share)
  }
  // pe is built from category prevalence, not the observed marginals — that's the point, it doesn't
  // inflate as marginals skew. AC1/AC2 overstate where kappa understates (Research §1), so this is
  // reported beside alpha, never instead of it.
  const pe = (totalWeight * spread) / (q * (q - 1))
  if (!(pe < 1)) return NaN

  return (pa - pe) / (1 - pe)
}
