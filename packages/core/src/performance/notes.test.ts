import { test, expect } from 'bun:test'
import { SIGNALS, SIGNAL_IDS } from '@levelhead/contracts'
import type { PerformanceBaseline, PerformanceObservation, SignalId } from '@levelhead/contracts'
import type { SessionContrast } from './observe.ts'
import { CONTRAST_RATIO_THRESHOLD, MIN_BASELINE_N, notesFrom } from './notes.ts'

function observed(attemptId: string, signal: SignalId, value: number): PerformanceObservation {
  return {
    attemptId,
    signal,
    value,
    unit: SIGNALS[signal].unit,
    source: 'prosody',
    boundary: 'observation_only_never_competence',
  }
}

// p25 120, p75 160, so the interquartile range is 40 and the fence sits at 60 and 220.
const TEMPO_BASELINE: PerformanceBaseline = {
  signal: 'articulation_rate',
  n: 5,
  median: 140,
  p25: 120,
  p75: 160,
  earliestAt: '2026-05-01T10:00:00.000Z',
  latestAt: '2026-09-01T10:00:00.000Z',
}

const THIN_BASELINE: PerformanceBaseline = {
  signal: 'filled_pause_rate',
  n: 2,
  median: 15,
  p25: 12.5,
  p75: 17.5,
  earliestAt: '2026-05-01T10:00:00.000Z',
  latestAt: '2026-08-01T10:00:00.000Z',
}

const OBSERVATIONS: PerformanceObservation[] = [
  observed('attempt-1', 'articulation_rate', 240),
  observed('attempt-2', 'articulation_rate', 150),
  observed('attempt-3', 'articulation_rate', 50),
  observed('attempt-4', 'articulation_rate', 40),
  observed('attempt-1', 'filled_pause_rate', 99),
]

const EARLY_LATE: SessionContrast = {
  contrast: 'early_vs_late_in_answer',
  signal: 'rate_drift_within_answer',
  earlier: 100,
  later: 150,
  ratio: 1.5,
  attemptIds: ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'],
}

const UNDER_PRESSURE: SessionContrast = {
  contrast: 'low_vs_high_pressure',
  signal: 'rate_change_under_pressure',
  earlier: 100,
  later: 110,
  ratio: 1.1,
  attemptIds: ['attempt-1', 'attempt-3'],
}

const AFTER_INTERRUPTION: SessionContrast = {
  contrast: 'before_vs_after_interruption',
  signal: 'interruption_recovery_time',
  earlier: 800,
  later: 400,
  ratio: 0.5,
  attemptIds: ['attempt-1', 'attempt-4'],
}

const CONTRASTS: SessionContrast[] = [EARLY_LATE, UNDER_PRESSURE, AFTER_INTERRUPTION]

test('a value outside the fence around the candidate own middle half raises one note per side', () => {
  const notes = notesFrom({
    observations: OBSERVATIONS,
    baselines: [TEMPO_BASELINE, THIN_BASELINE],
    contrasts: [],
  })

  expect(notes.map((note) => note.id)).toEqual([
    'baseline_drift:articulation_rate:above',
    'baseline_drift:articulation_rate:below',
  ])

  expect(notes[0]).toEqual({
    id: 'baseline_drift:articulation_rate:above',
    signal: 'articulation_rate',
    family: 'speech',
    summary:
      'tempo while actually speaking ran 240 words/min across 1 answer this session, above your own middle half of 120 to 160 words/min over 5 past observations (median 140 words/min).',
    trigger: {
      kind: 'baseline_drift',
      baseline: TEMPO_BASELINE,
      observed: 240,
      direction: 'above',
    },
    observationAttemptIds: ['attempt-1'],
    boundary: 'observation_only_never_competence',
  })

  // Two answers drifted low, so the note reports the middle of the two rather than the worse one.
  expect(notes[1]).toEqual({
    id: 'baseline_drift:articulation_rate:below',
    signal: 'articulation_rate',
    family: 'speech',
    summary:
      'tempo while actually speaking ran 45 words/min across 2 answers this session, below your own middle half of 120 to 160 words/min over 5 past observations (median 140 words/min).',
    trigger: {
      kind: 'baseline_drift',
      baseline: TEMPO_BASELINE,
      observed: 45,
      direction: 'below',
    },
    observationAttemptIds: ['attempt-3', 'attempt-4'],
    boundary: 'observation_only_never_competence',
  })
})

test('a value inside the fence raises nothing', () => {
  const notes = notesFrom({
    observations: [observed('attempt-2', 'articulation_rate', 150)],
    baselines: [TEMPO_BASELINE],
    contrasts: [],
  })

  expect(notes).toEqual([])
})

// The honest first-session output is silence about the baseline, not a band invented to fill it.
test('a baseline too thin to be a distribution raises nothing, however far the value sits', () => {
  expect(MIN_BASELINE_N).toBe(3)

  const notes = notesFrom({
    observations: [observed('attempt-1', 'filled_pause_rate', 99)],
    baselines: [THIN_BASELINE],
    contrasts: [],
  })

  expect(notes).toEqual([])
})

test('a first session has no baseline at all, so it raises no drift note', () => {
  const notes = notesFrom({ observations: OBSERVATIONS, baselines: [], contrasts: [] })

  expect(notes).toEqual([])
})

test('a contrast raises a note only once the two sides differ by the detection threshold', () => {
  const notes = notesFrom({ observations: [], baselines: [], contrasts: CONTRASTS })

  expect(notes.map((note) => note.id)).toEqual([
    'within_session_contrast:early_vs_late_in_answer',
    'within_session_contrast:before_vs_after_interruption',
  ])

  expect(notes[0]).toEqual({
    id: 'within_session_contrast:early_vs_late_in_answer',
    signal: 'rate_drift_within_answer',
    family: 'rhythm',
    summary:
      'the last third of your answers ran at 150 words/min against 100 words/min in the first third, a ratio of 1.50 across 4 answers.',
    trigger: {
      kind: 'within_session_contrast',
      contrast: 'early_vs_late_in_answer',
      earlier: 100,
      later: 150,
      ratio: 1.5,
    },
    observationAttemptIds: ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'],
    boundary: 'observation_only_never_competence',
  })

  expect(notes[1]?.summary).toBe(
    'after an interruption you began speaking after 400 ms against 800 ms on answers that were not interrupted, a ratio of 0.50 across 2 answers.',
  )
})

test('the contrast threshold treats speeding up and slowing down alike', () => {
  const at = (ratio: number): string[] =>
    notesFrom({
      observations: [],
      baselines: [],
      contrasts: [{ ...EARLY_LATE, ratio }],
    }).map((note) => note.id)

  expect(at(CONTRAST_RATIO_THRESHOLD)).toEqual(['within_session_contrast:early_vs_late_in_answer'])
  expect(at(1 / CONTRAST_RATIO_THRESHOLD)).toEqual([
    'within_session_contrast:early_vs_late_in_answer',
  ])
  expect(at(CONTRAST_RATIO_THRESHOLD - 0.01)).toEqual([])
  expect(at(1 / CONTRAST_RATIO_THRESHOLD + 0.01)).toEqual([])
  expect(at(1)).toEqual([])
})

test('a pressure contrast names the pressure level it split on', () => {
  const notes = notesFrom({
    observations: [],
    baselines: [],
    contrasts: [{ ...UNDER_PRESSURE, later: 200, ratio: 2 }],
  })

  expect(notes[0]?.summary).toBe(
    'at pressure 2 and above you ran 200 words/min against 100 words/min below it, a ratio of 2.00 across 2 answers.',
  )
  expect(notes[0]?.signal).toBe('rate_change_under_pressure')
})

test('drift notes come before contrast notes, and every note carries the answers behind it', () => {
  const notes = notesFrom({
    observations: OBSERVATIONS,
    baselines: [TEMPO_BASELINE, THIN_BASELINE],
    contrasts: CONTRASTS,
  })

  expect(notes.map((note) => note.trigger.kind)).toEqual([
    'baseline_drift',
    'baseline_drift',
    'within_session_contrast',
    'within_session_contrast',
  ])

  expect(notes.filter((note) => note.observationAttemptIds.length === 0)).toEqual([])
})

// The branch for a published band is written and unreachable. This is the premise that makes it
// unreachable, stated as a check rather than as a sentence, so the day a sourced band is added the
// note that fires is the one already written for it.
test('no signal carries a reference band today, so no note can claim an outside standard', () => {
  expect([...SIGNAL_IDS].filter((signal) => SIGNALS[signal].reference !== null)).toEqual([])

  const notes = notesFrom({
    observations: OBSERVATIONS,
    baselines: [TEMPO_BASELINE],
    contrasts: CONTRASTS,
  })

  expect(notes.filter((note) => note.trigger.kind === 'reference_breach')).toEqual([])
})
