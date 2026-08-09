import { test, expect } from 'bun:test'
import { bootstrapCi, bootstrapCiOf, seededRng } from './bootstrap.ts'
import { krippendorffOrdinalAlpha } from './agreement.ts'

const mean = (sample: readonly number[]): number =>
  sample.reduce((total, value) => total + value, 0) / sample.length

const values = [2, 4, 4, 4, 5, 5, 7, 9]

test('the same seed replays byte-identical output', () => {
  const first = bootstrapCi(values, mean, { seed: 7 })
  const second = bootstrapCi(values, mean, { seed: 7 })
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
})

test('a different seed gives a different interval', () => {
  const first = bootstrapCi(values, mean, { seed: 7 })
  const other = bootstrapCi(values, mean, { seed: 8 })
  expect(JSON.stringify(first)).not.toBe(JSON.stringify(other))
})

test('the point estimate is the statistic on the original sample, not a resample average', () => {
  expect(bootstrapCi(values, mean, { seed: 1 }).point).toBe(5)
})

test('defaults are 2000 resamples at 95%', () => {
  const interval = bootstrapCi(values, mean, { seed: 3 })
  expect(interval.resamples).toBe(2000)
  expect(interval.lower).toBeLessThan(interval.point)
  expect(interval.upper).toBeGreaterThan(interval.point)
})

test('a wider alpha gives a narrower interval', () => {
  const wide = bootstrapCi(values, mean, { seed: 5, alpha: 0.05 })
  const narrow = bootstrapCi(values, mean, { seed: 5, alpha: 0.5 })
  expect(narrow.lower).toBeGreaterThanOrEqual(wide.lower)
  expect(narrow.upper).toBeLessThanOrEqual(wide.upper)
})

test('a zero-variance sample gives a degenerate interval rather than an error', () => {
  const interval = bootstrapCi([3, 3, 3, 3], mean, { seed: 11 })
  expect(interval.point).toBe(3)
  expect(interval.lower).toBe(3)
  expect(interval.upper).toBe(3)
})

test('an empty sample reports nothing rather than something', () => {
  const interval = bootstrapCi([], mean, { seed: 1 })
  expect(interval.point).toBeNaN()
  expect(interval.lower).toBeNaN()
  expect(interval.upper).toBeNaN()
  expect(interval.resamples).toBe(0)
})

test('resamples reports the replicates actually used, dropping the ones nobody could compute', () => {
  const units: (number | null)[][] = [
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 3],
  ]
  const interval = bootstrapCiOf(units, krippendorffOrdinalAlpha, { seed: 3, resamples: 500 })
  expect(interval.point).toBeCloseTo(0.825, 12)
  // Resampling four units with replacement sometimes draws four copies of one unit, which has no
  // variance and no computable alpha. Those replicates are dropped, so the count falls below 500.
  expect(interval.resamples).toBeLessThan(500)
  expect(interval.resamples).toBeGreaterThan(400)
  expect(interval.lower).toBeLessThanOrEqual(interval.point)
  expect(interval.upper).toBeGreaterThanOrEqual(interval.point)
})

test('bootstrapCiOf resamples arbitrary items, which is what agreement over rated units needs', () => {
  const items = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]
  const first = bootstrapCiOf(items, (sample) => mean(sample.map((item) => item.v)), { seed: 21 })
  const second = bootstrapCiOf(items, (sample) => mean(sample.map((item) => item.v)), { seed: 21 })
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  expect(first.point).toBe(2.5)
})

test('bad options fail loudly instead of silently picking a default', () => {
  expect(() => bootstrapCi(values, mean, { seed: 1, resamples: 0 })).toThrow(RangeError)
  expect(() => bootstrapCi(values, mean, { seed: 1, resamples: 1.5 })).toThrow(RangeError)
  expect(() => bootstrapCi(values, mean, { seed: 1, alpha: 0 })).toThrow(RangeError)
  expect(() => bootstrapCi(values, mean, { seed: 1, alpha: 1 })).toThrow(RangeError)
  expect(() => bootstrapCi(values, mean, { seed: 0.5 })).toThrow(RangeError)
})

test('the rng is a pure function of its seed', () => {
  const draw = (seed: number): number[] => {
    const rng = seededRng(seed)
    return [rng(), rng(), rng(), rng()]
  }
  expect(draw(42)).toEqual(draw(42))
  expect(draw(42)).not.toEqual(draw(43))
  for (const value of draw(42)) {
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(0x100000000)
  }
})
