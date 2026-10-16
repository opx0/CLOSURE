import { expect, test } from 'bun:test'
import { PERFORMANCE_BOUNDARY, type PerformanceObservation } from '@levelhead/contracts'
import { performanceTrends, type PerformanceSession } from './trends.ts'

function observed(
  signal: PerformanceObservation['signal'],
  value: number,
  unit: PerformanceObservation['unit'],
): PerformanceObservation {
  return {
    attemptId: 'att_1',
    signal,
    value,
    unit,
    source: 'prosody',
    boundary: PERFORMANCE_BOUNDARY,
  }
}

// Deliberately out of chronological order, and with the later registry signal listed first, so the
// two orderings the function imposes are both visible in the result.
const history: PerformanceSession[] = [
  {
    sessionId: 'ses_2',
    at: '2026-09-10T10:00:00.000Z',
    observations: [observed('response_latency', 2310, 'milliseconds')],
  },
  {
    sessionId: 'ses_1',
    at: '2026-09-03T10:00:00.000Z',
    observations: [
      observed('response_latency', 1800, 'milliseconds'),
      observed('articulation_rate', 140, 'words_per_minute'),
      observed('articulation_rate', 150, 'words_per_minute'),
    ],
  },
  {
    sessionId: 'ses_3',
    at: '2026-09-17T10:00:00.000Z',
    observations: [observed('articulation_rate', 160, 'words_per_minute')],
  },
]

test('a session contributes one point per signal, at the median of that session', () => {
  const trends = performanceTrends(history)

  expect(trends).toEqual([
    {
      signal: 'articulation_rate',
      points: [
        { at: '2026-09-03T10:00:00.000Z', sessionId: 'ses_1', value: 145 },
        { at: '2026-09-17T10:00:00.000Z', sessionId: 'ses_3', value: 160 },
      ],
      boundary: PERFORMANCE_BOUNDARY,
    },
    {
      signal: 'response_latency',
      points: [
        { at: '2026-09-03T10:00:00.000Z', sessionId: 'ses_1', value: 1800 },
        { at: '2026-09-10T10:00:00.000Z', sessionId: 'ses_2', value: 2310 },
      ],
      boundary: PERFORMANCE_BOUNDARY,
    },
  ])
})

// ses_2 measured no articulation rate. Carrying the previous value forward would draw a session
// that never happened.
test('a session that did not measure a signal leaves a hole rather than a repeated value', () => {
  const rate = performanceTrends(history)[0]

  expect(rate?.points.map((point) => point.sessionId)).toEqual(['ses_1', 'ses_3'])
})

test('a signal nobody measured gets no series at all', () => {
  expect(performanceTrends(history).map((trend) => trend.signal)).toEqual([
    'articulation_rate',
    'response_latency',
  ])
  expect(performanceTrends([])).toEqual([])
})

test('the median of an odd run is the middle value, not the mean of the run', () => {
  const trends = performanceTrends([
    {
      sessionId: 'ses_1',
      at: '2026-09-03T10:00:00.000Z',
      observations: [
        observed('gesture_rate', 1, 'per_minute'),
        observed('gesture_rate', 2, 'per_minute'),
        observed('gesture_rate', 99, 'per_minute'),
      ],
    },
  ])

  expect(trends[0]?.points[0]?.value).toBe(2)
})
