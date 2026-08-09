import { test, expect } from 'bun:test'
import {
  riskCoverage,
  accuracyAtCoverage,
  FIXED_COVERAGE_LEVELS,
  type SelectiveItem,
} from './abstention.ts'

// Hand-computed. Sorted by confidence the head is correct, correct, wrong, correct, so the
// selective risks are 0, 0, 1/3, 1/4 and AURC is their mean, 7/48.
const HAND_CHECKED: SelectiveItem[] = [
  { confidence: 0.7, correct: false },
  { confidence: 0.9, correct: true },
  { confidence: 0.6, correct: true },
  { confidence: 0.8, correct: true },
]

test('the curve and AURC match the hand-computed values', () => {
  const { curve, aurc } = riskCoverage(HAND_CHECKED)
  expect(curve).toEqual([
    { coverage: 0.25, risk: 0 },
    { coverage: 0.5, risk: 0 },
    { coverage: 0.75, risk: 1 / 3 },
    { coverage: 1, risk: 0.25 },
  ])
  expect(aurc).toBeCloseTo(7 / 48, 12)
})

test('the curve is ordered by confidence descending regardless of input order', () => {
  const shuffled = [...HAND_CHECKED].reverse()
  expect(riskCoverage(shuffled)).toEqual(riskCoverage(HAND_CHECKED))
})

test('AURC is 0 when nothing is wrong and 1 when everything is', () => {
  const allRight = [0.9, 0.5, 0.1].map((confidence) => ({ confidence, correct: true }))
  const allWrong = [0.9, 0.5, 0.1].map((confidence) => ({ confidence, correct: false }))
  expect(riskCoverage(allRight).aurc).toBe(0)
  expect(riskCoverage(allWrong).aurc).toBe(1)
})

test('confidence that ranks errors last beats confidence that ranks them first', () => {
  const wellRanked: SelectiveItem[] = [
    { confidence: 0.9, correct: true },
    { confidence: 0.8, correct: true },
    { confidence: 0.2, correct: false },
    { confidence: 0.1, correct: false },
  ]
  const inverted: SelectiveItem[] = wellRanked.map((item) => ({
    confidence: 1 - item.confidence,
    correct: item.correct,
  }))
  expect(riskCoverage(wellRanked).aurc).toBeLessThan(riskCoverage(inverted).aurc)
  expect(riskCoverage(wellRanked).curve.at(-1)?.risk).toBe(
    riskCoverage(inverted).curve.at(-1)?.risk as number,
  )
})

test('an abstain-on-everything-hard evaluator is visible in the curve, not hidden by it', () => {
  const gamed: SelectiveItem[] = [
    { confidence: 0.99, correct: true },
    { confidence: 0.01, correct: false },
    { confidence: 0.01, correct: false },
    { confidence: 0.01, correct: false },
  ]
  expect(accuracyAtCoverage(gamed, 0.25)).toBe(1)
  expect(accuracyAtCoverage(gamed, 1)).toBe(0.25)
  // Selective risks are 0, 1/2, 2/3, 3/4; AURC is their mean, 23/48.
  expect(riskCoverage(gamed).aurc).toBeCloseTo(23 / 48, 12)
})

const TEN: SelectiveItem[] = [true, true, true, true, true, true, false, true, false, false].map(
  (correct, index) => ({ confidence: 1 - index / 10, correct }),
)

test('accuracy at the pre-declared coverage levels', () => {
  // 0.7 of ten items covers seven, of which six are right; 0.85 rounds to nine, of which seven are.
  expect(accuracyAtCoverage(TEN, 0.7)).toBeCloseTo(6 / 7, 12)
  expect(accuracyAtCoverage(TEN, 0.85)).toBeCloseTo(7 / 9, 12)
  expect(accuracyAtCoverage(TEN, 1)).toBe(0.7)
})

test('accuracy at full coverage is one minus the risk at full coverage', () => {
  const { curve } = riskCoverage(TEN)
  expect(accuracyAtCoverage(TEN, 1)).toBeCloseTo(1 - (curve.at(-1)?.risk as number), 12)
})

test('the pre-declared levels are 70% and 85%', () => {
  expect(FIXED_COVERAGE_LEVELS).toEqual([0.7, 0.85])
  for (const level of FIXED_COVERAGE_LEVELS) {
    expect(Number.isFinite(accuracyAtCoverage(TEN, level))).toBe(true)
  }
})

test('an empty set reports nothing rather than perfect', () => {
  expect(riskCoverage([])).toEqual({ curve: [], aurc: NaN })
  expect(accuracyAtCoverage([], 0.7)).toBeNaN()
  expect(accuracyAtCoverage(HAND_CHECKED, 0)).toBeNaN()
})

test('a coverage outside [0, 1] fails loudly', () => {
  expect(() => accuracyAtCoverage(HAND_CHECKED, 1.5)).toThrow(RangeError)
  expect(() => accuracyAtCoverage(HAND_CHECKED, -0.1)).toThrow(RangeError)
  expect(() => accuracyAtCoverage(HAND_CHECKED, NaN)).toThrow(RangeError)
})

test('riskCoverage does not mutate its input', () => {
  const items = [...HAND_CHECKED]
  riskCoverage(items)
  accuracyAtCoverage(items, 0.5)
  expect(items).toEqual(HAND_CHECKED)
})
