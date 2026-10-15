import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// `tests/invariants/delivery-is-not-competence.test.ts` greps the debrief's two lane modules. The
// longitudinal view splits the same way and for the same reason, so it gets the same check here
// rather than relying on whoever edits it next remembering the rule.
const PERFORMANCE_TYPES =
  /\b(ProsodyReport|KinematicsReport|PerformanceObservation|PerformanceNote|PerformanceBaseline|PerformanceDrill|SignalId|SIGNALS)\b/

const COMPETENCE_TYPES = /\b(Finding|GapEntry|Rubric|Competency|ClaimVerdict|ComposureSignal)\b/

function read(name: string): string {
  return readFileSync(join(import.meta.dir, name), 'utf8')
}

test('the performance series names no judged type', () => {
  expect(COMPETENCE_TYPES.test(read('trends.ts'))).toBe(false)
})

test('the ledger series and the composure cross-cut name no measured signal', () => {
  expect(PERFORMANCE_TYPES.test(read('competence-trends.ts'))).toBe(false)
})

// Positive controls. Without these, the two checks above would keep passing if a file were emptied
// or renamed out from under them.
test('each module really is the lane it claims to be', () => {
  expect(read('trends.ts')).toContain('PerformanceObservation')
  expect(read('competence-trends.ts')).toContain('COMPOSURE_HELD')
  expect(read('competence-trends.ts')).toContain('GapStatus')
})

// A combined series would need one y-axis, and putting a composure finding and a words-per-minute
// number on one axis means inventing a scale for both.
test('neither module declares a score of any kind', () => {
  const both = `${read('trends.ts')}\n${read('competence-trends.ts')}`

  expect(both).not.toMatch(/\b(readiness|overall|composite|aggregate|total)_?[Ss]core\b/)
})
