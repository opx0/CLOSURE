import { test, expect } from 'bun:test'
import { krippendorffOrdinalAlpha, gwetAc2, type Ratings } from './agreement.ts'
import { seededRng } from './bootstrap.ts'

// Hand-computed reference. Four units, two raters, categories 1-4 each appearing twice, so every
// marginal n_c = 2 and n = 8. Coincidences land on o_11 = o_22 = 2 and o_34 = o_43 = 2, and the
// ordinal difference for the one adjacent disagreement is (2 + 2 - 2)^2 = 4.
//   observed  = 2*4 + 2*4 = 16
//   expected  = 4 * (8 + 32 + 72 + 8 + 32 + 8) = 640
//   alpha     = 1 - (n - 1) * observed / expected = 1 - 7 * 16 / 640 = 0.825
const HAND_CHECKED: Ratings = [
  [1, 1],
  [2, 2],
  [3, 4],
  [4, 3],
]

test('ordinal alpha matches the hand-computed 4-unit value', () => {
  expect(krippendorffOrdinalAlpha(HAND_CHECKED)).toBeCloseTo(0.825, 12)
})

test('a unit with only one rating is unpairable and changes nothing', () => {
  const withDangling: Ratings = [...HAND_CHECKED, [2, null]]
  expect(krippendorffOrdinalAlpha(withDangling)).toBeCloseTo(0.825, 12)
})

test('missing ratings are dropped, not treated as a category', () => {
  const sparse: Ratings = [
    [1, 1, null],
    [2, null, 2],
    [null, 3, 4],
    [4, 3, null],
  ]
  expect(krippendorffOrdinalAlpha(sparse)).toBeCloseTo(0.825, 12)
})

test('perfect agreement is exactly 1', () => {
  expect(
    krippendorffOrdinalAlpha([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]),
  ).toBe(1)
})

test('ordinal distance ranks a near miss above a far one', () => {
  const near = krippendorffOrdinalAlpha([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
  ])
  const far = krippendorffOrdinalAlpha([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 1],
  ])
  expect(near).toBeGreaterThan(far)
})

test('unequal marginals do not break the computation', () => {
  const skewed: Ratings = [
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 3],
    [1, 2],
  ]
  const alpha = krippendorffOrdinalAlpha(skewed)
  expect(Number.isFinite(alpha)).toBe(true)
  expect(alpha).toBeLessThanOrEqual(1)
})

test('a coefficient nobody can compute reads as NaN, never as agreement', () => {
  // No variance: every rating in one category, so there is no chance agreement to correct against.
  expect(
    krippendorffOrdinalAlpha([
      [3, 3],
      [3, 3],
    ]),
  ).toBeNaN()
  expect(
    gwetAc2([
      [3, 3],
      [3, 3],
    ]),
  ).toBeNaN()
  // One pairable unit: D_e would be built from that unit's own marginals.
  expect(krippendorffOrdinalAlpha([[1, 2]])).toBeNaN()
  expect(gwetAc2([[1, 2]])).toBeNaN()
  expect(krippendorffOrdinalAlpha([[1, null], [null, 2], []])).toBeNaN()
  expect(gwetAc2([[1, null], [null, 2], []])).toBeNaN()
  expect(krippendorffOrdinalAlpha([])).toBeNaN()
  expect(gwetAc2([])).toBeNaN()
})

test("Gwet's AC2 matches the hand-computed value on the same matrix", () => {
  // Ordinal weights over four categories: 1 - C(d + 1, 2) / C(4, 2), so 1, 5/6, 1/2, 0 and
  // T_w = 11. p_a = (1 + 1 + 5/6 + 5/6) / 4 = 11/12; every pi_k = 1/4 so the spread is 3/4 and
  // p_e = 11 * (3/4) / 12 = 11/16. AC2 = (11/12 - 11/16) / (1 - 11/16) = 11/15.
  expect(gwetAc2(HAND_CHECKED)).toBeCloseTo(11 / 15, 12)
})

test('AC2 reaches 1 on perfect agreement and accepts custom weights', () => {
  const perfect: Ratings = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ]
  expect(gwetAc2(perfect)).toBeCloseTo(1, 12)
  const nominal = (a: number, b: number): number => (a === b ? 1 : 0)
  expect(gwetAc2(perfect, nominal)).toBeCloseTo(1, 12)
  // Nominal weights punish the adjacent disagreement that ordinal weights partly forgive.
  expect(gwetAc2(HAND_CHECKED, nominal)).toBeLessThan(gwetAc2(HAND_CHECKED))
})

test('AC2 handles missing ratings and uneven rater counts per unit', () => {
  const uneven: Ratings = [
    [1, 1, 1],
    [2, 2, null],
    [3, 4, 3],
    [4, 3, null],
  ]
  const ac2 = gwetAc2(uneven)
  expect(Number.isFinite(ac2)).toBe(true)
  expect(ac2).toBeLessThanOrEqual(1)
})

const randomRatings = (seed: number, units: number, levels: number): Ratings => {
  const rng = seededRng(seed)
  const draw = (): number => 1 + Math.floor((rng() / 0x100000000) * levels)
  return Array.from({ length: units }, () => [draw(), draw()])
}

test('perfect agreement is 1 and random agreement is near 0, across seeds', () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
    const random = randomRatings(seed, 500, 5)
    expect(Math.abs(krippendorffOrdinalAlpha(random))).toBeLessThan(0.1)

    // Same marginals, but every rater pair now agrees.
    const perfect: Ratings = random.map((unit) => [unit[0] as number, unit[0] as number])
    expect(krippendorffOrdinalAlpha(perfect)).toBe(1)
    expect(gwetAc2(perfect)).toBeCloseTo(1, 12)
  }
})

test('alpha is bounded above by 1 and systematic disagreement drives it negative', () => {
  const inverted: Ratings = [
    [1, 5],
    [5, 1],
    [1, 5],
    [5, 1],
  ]
  const alpha = krippendorffOrdinalAlpha(inverted)
  expect(alpha).toBeLessThan(0)
  expect(alpha).toBeGreaterThanOrEqual(-1)
})
