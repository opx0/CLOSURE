import { test, expect } from 'bun:test'
import { SIGNALS } from '@levelhead/contracts'
import type { PerformanceObservation, SignalId } from '@levelhead/contracts'
import { baselinesFrom, medianOf, quantile, type TimestampedObservation } from './baseline.ts'

function past(signal: SignalId, value: number, at: string): TimestampedObservation {
  const observation: PerformanceObservation = {
    attemptId: `attempt-${value}`,
    signal,
    value,
    unit: SIGNALS[signal].unit,
    source: 'prosody',
    boundary: 'observation_only_never_competence',
  }
  return { observation, at }
}

const HISTORY: TimestampedObservation[] = [
  past('articulation_rate', 140, '2026-06-01T10:00:00.000Z'),
  past('articulation_rate', 100, '2026-05-01T10:00:00.000Z'),
  past('articulation_rate', 200, '2026-08-01T10:00:00.000Z'),
  past('articulation_rate', 120, '2026-07-01T10:00:00.000Z'),
  past('articulation_rate', 160, '2026-09-01T10:00:00.000Z'),
  past('filled_pause_rate', 20, '2026-08-01T10:00:00.000Z'),
  past('filled_pause_rate', 10, '2026-05-01T10:00:00.000Z'),
  past('answer_duration', 20, '2026-06-01T10:00:00.000Z'),
  past('answer_duration', 60, '2026-07-01T10:00:00.000Z'),
  past('answer_duration', 10, '2026-05-01T10:00:00.000Z'),
]

test('a quantile lands between the two order statistics that straddle it', () => {
  // [100, 120, 140, 160, 200] puts every quartile on an element, so the interpolation is visible
  // only in the shorter runs below.
  expect(quantile([100, 120, 140, 160, 200], 0.25)).toBe(120)
  expect(quantile([100, 120, 140, 160, 200], 0.5)).toBe(140)
  expect(quantile([100, 120, 140, 160, 200], 0.75)).toBe(160)

  expect(quantile([10, 20], 0.25)).toBe(12.5)
  expect(quantile([10, 20], 0.5)).toBe(15)
  expect(quantile([10, 20], 0.75)).toBe(17.5)

  expect(quantile([10, 20, 60], 0.25)).toBe(15)
  expect(quantile([10, 20, 60], 0.5)).toBe(20)
  expect(quantile([10, 20, 60], 0.75)).toBe(40)

  expect(quantile([7], 0.25)).toBe(7)
  expect(quantile([10, 20, 60], 0)).toBe(10)
  expect(quantile([10, 20, 60], 1)).toBe(60)
})

test('a median sorts its input rather than trusting the order it arrived in', () => {
  expect(medianOf([60, 10, 20])).toBe(20)
  expect(medianOf([20, 10])).toBe(15)
  expect(medianOf([5])).toBe(5)
})

test('a baseline is the candidate own distribution for one signal, and nothing else', () => {
  const baselines = baselinesFrom(HISTORY)

  expect(baselines.map((baseline) => baseline.signal)).toEqual([
    'articulation_rate',
    'filled_pause_rate',
    'answer_duration',
  ])

  expect(baselines[0]).toEqual({
    signal: 'articulation_rate',
    n: 5,
    median: 140,
    p25: 120,
    p75: 160,
    earliestAt: '2026-05-01T10:00:00.000Z',
    latestAt: '2026-09-01T10:00:00.000Z',
  })

  expect(baselines[1]).toEqual({
    signal: 'filled_pause_rate',
    n: 2,
    median: 15,
    p25: 12.5,
    p75: 17.5,
    earliestAt: '2026-05-01T10:00:00.000Z',
    latestAt: '2026-08-01T10:00:00.000Z',
  })

  expect(baselines[2]).toEqual({
    signal: 'answer_duration',
    n: 3,
    median: 20,
    p25: 15,
    p75: 40,
    earliestAt: '2026-05-01T10:00:00.000Z',
    latestAt: '2026-07-01T10:00:00.000Z',
  })
})

test('a signal with no history gets no baseline rather than an empty one', () => {
  const baselines = baselinesFrom(HISTORY)

  expect(baselines.map((baseline) => baseline.signal)).not.toContain('gesture_rate')
  expect(baselinesFrom([])).toEqual([])
})

// Two ISO spellings of the same day sort differently as strings and correctly as instants. A
// baseline that reported the wrong window would put a stale date on a fresh distribution.
test('the window is read from the instants, not from how the timestamps were spelled', () => {
  const baselines = baselinesFrom([
    past('gesture_rate', 4, '2026-09-02T00:00:00.000Z'),
    past('gesture_rate', 6, '2026-09-01T23:00:00.000-02:00'),
  ])

  expect(baselines[0]?.earliestAt).toBe('2026-09-02T00:00:00.000Z')
  expect(baselines[0]?.latestAt).toBe('2026-09-01T23:00:00.000-02:00')
})

test('building a baseline leaves the history untouched', () => {
  const history = [...HISTORY]
  baselinesFrom(history)

  expect(history.map((row) => row.observation.value)).toEqual([
    140, 100, 200, 120, 160, 20, 10, 20, 60, 10,
  ])
})
