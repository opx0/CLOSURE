import { expect, test } from 'bun:test'
import { DELIVERY_BOUNDARY } from '@levelhead/contracts'
import { LONG_PAUSE_MS, measureDelivery, renderDelivery } from './measure.ts'

const turn = {
  attemptId: 'att_1',
  transcript: 'Um, we basically leased each job, you know, for thirty seconds.',
  audioMs: 6_000,
  pauses: [
    { atMs: 900, durationMs: 400 },
    { atMs: 2_400, durationMs: LONG_PAUSE_MS },
    { atMs: 4_000, durationMs: 3_200 },
  ],
}

test('pace is words over spoken time, not over wall clock', () => {
  const report = measureDelivery(turn)

  expect(report.wordCount).toBe(11)
  expect(report.spokenSeconds).toBe(6)
  expect(report.wordsPerMinute).toBeCloseTo(110, 0)
})

test('a pause counts only once it is long enough to be an observation', () => {
  const report = measureDelivery(turn)

  expect(report.longPauseCount).toBe(2)
  expect(report.longestPauseMs).toBe(3_200)
})

test('multi-word fillers are counted as phrases, not as their parts', () => {
  const report = measureDelivery(turn)

  expect(report.fillerCounts['um']).toBe(1)
  expect(report.fillerCounts['you know']).toBe(1)
  expect(report.fillerCounts['basically']).toBe(1)
  expect(report.fillerRatePerHundredWords).toBeCloseTo((3 / 11) * 100, 5)
})

test('silence produces zeros rather than an invented pace', () => {
  const report = measureDelivery({ attemptId: 'att_2', transcript: '', audioMs: 0, pauses: [] })

  expect(report.wordsPerMinute).toBe(0)
  expect(report.fillerRatePerHundredWords).toBe(0)
})

// The boundary is a value on the record, so a delivery report cannot be passed off as a judgment
// anywhere it travels — including out of the HTTP API and into an export bundle.
test('every report carries the boundary that it is never competence', () => {
  const report = measureDelivery(turn)

  expect(report.boundary).toBe(DELIVERY_BOUNDARY)
  expect(renderDelivery(report).join('\n')).toContain('never part of a finding')
  expect(Object.keys(report)).not.toContain('verdict')
  expect(Object.keys(report)).not.toContain('confidence')
})
