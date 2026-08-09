import { test, expect } from 'bun:test'
import { brierDecomposed, type Forecast } from './calibration.ts'

const at = (p: number, outcomes: readonly (0 | 1)[]): Forecast[] =>
  outcomes.map((outcome) => ({ p, outcome }))

// Twelve forecasts on three distinct probabilities, each landing alone in its bin, so the Murphy
// identity holds exactly rather than approximately.
//   base rate   = 5/12
//   brier       = (0.04 + 0.5 + 0.5 + 0.03 + 0.81) / 12 = 0.156666...
//   reliability = (4*0.01 + 0 + 4*0.0225) / 12          = 0.0108333...
//   resolution  = 4*(0.173611 + 0.006944 + 0.111111)/12 = 0.0972222...
//   uncertainty = (5/12)(7/12) = 35/144                 = 0.2430555...
const HAND_CHECKED: Forecast[] = [
  ...at(0.1, [0, 0, 0, 0]),
  ...at(0.5, [1, 1, 0, 0]),
  ...at(0.9, [1, 1, 1, 0]),
]

test('the decomposition matches the hand-computed values', () => {
  const result = brierDecomposed(HAND_CHECKED)
  expect(result.brier).toBeCloseTo(1.88 / 12, 12)
  expect(result.reliability).toBeCloseTo(0.13 / 12, 12)
  expect(result.resolution).toBeCloseTo(1.1666666666666667 / 12, 12)
  expect(result.uncertainty).toBeCloseTo(35 / 144, 12)
})

test('reliability - resolution + uncertainty reconstructs the Brier score', () => {
  const result = brierDecomposed(HAND_CHECKED)
  const reconstructed = result.reliability - result.resolution + result.uncertainty
  expect(Math.abs(result.brier - reconstructed)).toBeLessThan(1e-12)
})

test('every bin ships with its raw count, including the empty ones', () => {
  const result = brierDecomposed(HAND_CHECKED)
  expect(result.bins).toHaveLength(10)
  expect(result.bins.reduce((total, bin) => total + bin.count, 0)).toBe(12)

  const populated = result.bins.filter((bin) => bin.count > 0)
  expect(populated).toEqual([
    { from: 0.1, to: 0.2, count: 4, meanForecast: 0.1, observedRate: 0 },
    { from: 0.5, to: 0.6, count: 4, meanForecast: 0.5, observedRate: 0.5 },
    { from: 0.9, to: 1, count: 4, meanForecast: 0.9, observedRate: 0.75 },
  ])
  for (const bin of result.bins.filter((candidate) => candidate.count === 0)) {
    expect(bin.meanForecast).toBeNaN()
    expect(bin.observedRate).toBeNaN()
  }
})

test('a forecast always lands in the bin whose published edges it satisfies', () => {
  // 0.29 * 100 evaluates to 28.999999999999996, so flooring the scaled value would file this one
  // bin low and contradict the `from`/`to` reported beside it.
  const result = brierDecomposed([{ p: 0.29, outcome: 1 }], 100)
  const home = result.bins.find((bin) => bin.count > 0)
  expect(home?.from).toBeCloseTo(0.29, 12)
  expect(home?.to).toBeCloseTo(0.3, 12)
  for (const bin of result.bins.filter((candidate) => candidate.count > 0)) {
    expect(bin.meanForecast).toBeGreaterThanOrEqual(bin.from)
    expect(bin.meanForecast).toBeLessThanOrEqual(bin.to)
  }
})

test('p = 1 lands in the last bin, which is closed on the right', () => {
  const result = brierDecomposed([{ p: 1, outcome: 1 }])
  expect(result.bins[9]?.count).toBe(1)
  expect(result.brier).toBe(0)
})

test('a perfectly calibrated but uninformative forecaster has zero reliability and zero resolution', () => {
  // Predicting the base rate on every item: nothing to correct, nothing discriminated. Brier
  // collapses to the uncertainty, which is why the flagship bar demands resolution > 0 as well.
  const half = at(0.5, [1, 1, 0, 0])
  const result = brierDecomposed(half)
  expect(result.reliability).toBeCloseTo(0, 12)
  expect(result.resolution).toBeCloseTo(0, 12)
  expect(result.uncertainty).toBeCloseTo(0.25, 12)
  expect(result.brier).toBeCloseTo(0.25, 12)
})

test('a confidently wrong forecaster is punished in the reliability component', () => {
  const wrong = brierDecomposed([...at(0.9, [0, 0, 0, 0]), ...at(0.1, [1, 1, 1, 1])])
  expect(wrong.reliability).toBeCloseTo(0.81, 12)
  expect(wrong.brier).toBeCloseTo(0.81, 12)
})

test('the bin count is configurable and the totals survive it', () => {
  const coarse = brierDecomposed(HAND_CHECKED, 2)
  expect(coarse.bins).toHaveLength(2)
  expect(coarse.bins.reduce((total, bin) => total + bin.count, 0)).toBe(12)
  // Brier and uncertainty are computed from the items, so no binning choice can move them.
  expect(coarse.brier).toBeCloseTo(1.88 / 12, 12)
  expect(coarse.uncertainty).toBeCloseTo(35 / 144, 12)
})

test('an empty set reports NaN scores rather than a flattering zero', () => {
  const result = brierDecomposed([])
  expect(result.brier).toBeNaN()
  expect(result.reliability).toBeNaN()
  expect(result.resolution).toBeNaN()
  expect(result.uncertainty).toBeNaN()
  expect(result.bins).toHaveLength(10)
  expect(result.bins.every((bin) => bin.count === 0)).toBe(true)
})

test('an out-of-range probability is a bug and fails loudly', () => {
  expect(() => brierDecomposed([{ p: 1.2, outcome: 1 }])).toThrow(RangeError)
  expect(() => brierDecomposed([{ p: -0.1, outcome: 0 }])).toThrow(RangeError)
  expect(() => brierDecomposed([{ p: NaN, outcome: 0 }])).toThrow(RangeError)
  expect(() => brierDecomposed(HAND_CHECKED, 0)).toThrow(RangeError)
})
