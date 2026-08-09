import { expect, test } from 'bun:test'
import {
  ERROR_CLASS_MEANING,
  EVALUATOR_ERROR_CLASSES,
  isEvaluatorErrorClass,
  tallyErrors,
} from './error-taxonomy.ts'

test('every named error class says what it means', () => {
  for (const one of EVALUATOR_ERROR_CLASSES) {
    expect(ERROR_CLASS_MEANING[one].length).toBeGreaterThan(20)
  }
})

test('an unknown class is refused rather than recorded as a new one', () => {
  expect(isEvaluatorErrorClass('invented_credit')).toBe(true)
  expect(isEvaluatorErrorClass('bad_vibes')).toBe(false)
})

// Counts only. A weighted total over error classes would be the readiness score again, pointed at
// the evaluator instead of the candidate.
test('the tally is counts, in the declared order, with no total and no severity', () => {
  const tally = tallyErrors(['missed_gap', 'invented_credit', 'missed_gap'])

  expect(tally).toEqual([
    { class: 'invented_credit', count: 1, meaning: ERROR_CLASS_MEANING.invented_credit },
    { class: 'missed_gap', count: 2, meaning: ERROR_CLASS_MEANING.missed_gap },
  ])
  for (const row of tally) expect(Object.keys(row)).toEqual(['class', 'count', 'meaning'])
})
