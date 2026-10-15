import { expect, test } from 'bun:test'
import {
  PERFORMANCE_BOUNDARY,
  type PerformanceBaseline,
  type PerformanceDrill,
  type PerformanceNote,
  type PerformanceObservation,
} from '@levelhead/contracts'
import { performanceLane, renderPerformanceLane, type PerformanceLaneInput } from './performance.ts'

function observation(
  attemptId: string,
  signal: PerformanceObservation['signal'],
  value: number,
  unit: PerformanceObservation['unit'],
): PerformanceObservation {
  return { attemptId, signal, value, unit, source: 'prosody', boundary: PERFORMANCE_BOUNDARY }
}

const baseline: PerformanceBaseline = {
  signal: 'articulation_rate',
  n: 6,
  median: 142,
  p25: 131,
  p75: 150,
  earliestAt: '2026-08-01T10:00:00.000Z',
  latestAt: '2026-09-15T10:00:00.000Z',
}

const drift: PerformanceNote = {
  id: 'note-1',
  signal: 'articulation_rate',
  family: 'speech',
  summary: 'faster than your own usual tempo',
  trigger: { kind: 'baseline_drift', baseline, observed: 168, direction: 'above' },
  observationAttemptIds: ['att_1', 'att_2'],
  boundary: PERFORMANCE_BOUNDARY,
}

const contrast: PerformanceNote = {
  id: 'note-2',
  signal: 'response_latency',
  family: 'speech',
  summary: 'longer silences once the questions got harder',
  trigger: {
    kind: 'within_session_contrast',
    contrast: 'low_vs_high_pressure',
    earlier: 1420,
    later: 2310,
    ratio: 1.6267605633802817,
  },
  observationAttemptIds: ['att_2'],
  boundary: PERFORMANCE_BOUNDARY,
}

const drill: PerformanceDrill = {
  noteId: 'note-1',
  signal: 'articulation_rate',
  instruction: 'Answer the next three questions at the pace you would use with a colleague.',
  retestSignal: 'articulation_rate',
  boundary: PERFORMANCE_BOUNDARY,
}

const input: PerformanceLaneInput = {
  observations: [
    observation('att_1', 'articulation_rate', 168, 'words_per_minute'),
    observation('att_2', 'articulation_rate', 164, 'words_per_minute'),
    observation('att_2', 'response_latency', 2310, 'milliseconds'),
  ],
  notes: [drift, contrast],
  drills: [drill],
  baselines: [baseline],
}

test('a signal measured with no baseline behind it is counted, not given an invented band', () => {
  const lane = performanceLane(input)

  expect(lane.signalsWithoutBaseline).toBe(1)
  expect(lane.observations).toHaveLength(3)
  expect(lane.baselines.map((one) => one.signal)).toEqual(['articulation_rate'])
})

test('a first session has no baseline for anything it measured', () => {
  const lane = performanceLane({ ...input, baselines: [], notes: [], drills: [] })

  expect(lane.signalsWithoutBaseline).toBe(2)
})

test('a note against a baseline shows the number, the baseline and the n it rests on', () => {
  const rendered = renderPerformanceLane(performanceLane(input))

  expect(rendered[0]).toBe('HOW YOU CAME ACROSS · measured from the recording, never judged')
  expect(rendered.slice(2, 7)).toEqual([
    '  tempo while actually speaking · faster than your own usual tempo',
    '    168 wpm this session, above your own baseline of 142 wpm (n=6, middle half 131–150)',
    '    Raised by att_1, att_2',
    '    Drill · Answer the next three questions at the pace you would use with a colleague. (retested by tempo while actually speaking)',
    '',
  ])
})

test('a note with no baseline shows the two conditions it contrasted inside this session', () => {
  const rendered = renderPerformanceLane(performanceLane(input))

  expect(rendered.slice(7, 10)).toEqual([
    '  silence before the first word · longer silences once the questions got harder',
    '    1420 ms then 2310 ms, ×1.63, at low pressure against at high pressure, both from this session',
    '    Raised by att_2',
  ])
})

// The three counts add up to the signals this session actually measured. The number of baselines the
// candidate holds is a different question and would read as an answer to this one.
test('the counts say how many signals this session is establishing a baseline for', () => {
  const rendered = renderPerformanceLane(performanceLane(input))

  const at = rendered.indexOf('  Signals measured this session   2')
  expect(rendered.slice(at, at + 3)).toEqual([
    '  Signals measured this session   2',
    '  Compared against your baseline  1',
    '  Measured for the first time     1',
  ])
  expect(rendered).toContain(
    '  This session establishes your baseline for them. There is nothing yet to compare them against.',
  )
})

test('a session where every signal already has a baseline establishes none', () => {
  const rendered = renderPerformanceLane(
    performanceLane({
      ...input,
      observations: [observation('att_1', 'articulation_rate', 168, 'words_per_minute')],
    }),
  )

  const at = rendered.indexOf('  Signals measured this session   1')
  expect(rendered.slice(at, at + 3)).toEqual([
    '  Signals measured this session   1',
    '  Compared against your baseline  1',
    '  Measured for the first time     0',
  ])
  expect(rendered.join('\n')).not.toContain('This session establishes your baseline')
})

test('a drill whose note is not in the debrief is shown as exactly that, not as history', () => {
  const rendered = renderPerformanceLane(performanceLane({ ...input, notes: [], drills: [drill] }))

  expect(rendered).toContain('  Drills with no note in this debrief')
  expect(rendered.join('\n')).not.toContain('carried over')
})

test('a quiet session says nothing moved rather than reaching for an adjective', () => {
  const rendered = renderPerformanceLane(
    performanceLane({ observations: [], notes: [], drills: [], baselines: [] }),
  )

  expect(rendered[2]).toBe('  No signal moved away from your own baseline or between conditions.')
  expect(rendered).toContain('  Signals measured this session   0')
  expect(rendered).toContain('  Measured for the first time     0')
})

// The closing that has travelled with these numbers since delivery was three of them. It lives in
// this module so it cannot be dropped by rendering the lane on its own.
test('the lane closes by saying the numbers judge no answer', () => {
  const rendered = renderPerformanceLane(performanceLane(input)).join('\n')

  expect(rendered).toContain('They say nothing about whether')
  expect(rendered).toContain('any answer was any good, they are never part of a finding')
  expect(rendered).toContain('never reach the gap')
  expect(rendered).not.toMatch(/%|\bscore\b|readiness|overall/i)
})
