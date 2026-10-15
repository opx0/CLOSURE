import { test, expect } from 'bun:test'
import { SIGNALS, SIGNAL_IDS } from '@levelhead/contracts'
import type {
  KinematicsReport,
  PerformanceObservation,
  ProsodyReport,
  SignalId,
  TimedWord,
} from '@levelhead/contracts'
import {
  contrastsAcrossSession,
  observationsAcrossSession,
  observationsFromKinematics,
  observationsFromProsody,
  type SessionAttemptInput,
} from './observe.ts'

// Laid out so every derived number below is one a reader can recompute. A word costs `stepMs`, so a
// run of words costs `count * stepMs` wherever it sits in the answer, and its tempo is `60000/step`.
function wordRun(from: number, count: number, startMs: number, stepMs: number): TimedWord[] {
  return Array.from({ length: count }, (_, offset) => ({
    text: `w${from + offset}`,
    startMs: startMs + offset * stepMs,
    endMs: startMs + offset * stepMs + stepMs,
  }))
}

function evenWords(count: number): TimedWord[] {
  return wordRun(0, count, 0, 600)
}

// 60 words: the first third at 600ms a word (100 words/min), the last third at 200ms (300).
const DRIFTING_WORDS: TimedWord[] = [
  ...wordRun(0, 20, 0, 600),
  ...wordRun(20, 20, 12_000, 600),
  ...wordRun(40, 20, 24_000, 200),
]

function prosodyOf(over: Partial<ProsodyReport> = {}): ProsodyReport {
  return {
    attemptId: 'attempt-1',
    audioMs: 60_000,
    words: DRIFTING_WORDS,
    // 30s of pause against 60s of audio, so 30s is spent speaking. Durations 3000/3000/12000/12000
    // have a mean of 7500 and a population deviation of 4500, so their coefficient of variation is
    // exactly 0.6.
    pauses: [
      { atMs: 5_000, durationMs: 3_000, kind: 'unfilled', position: 'mid_clause' },
      { atMs: 15_000, durationMs: 3_000, kind: 'unfilled', position: 'mid_clause' },
      { atMs: 30_000, durationMs: 12_000, kind: 'filled', position: 'clause_boundary' },
      { atMs: 45_000, durationMs: 12_000, kind: 'filled', position: 'clause_boundary' },
    ],
    hesitationClusters: [
      { atMs: 4_000, durationMs: 900, events: 2 },
      { atMs: 20_000, durationMs: 1_200, events: 3 },
      { atMs: 41_000, durationMs: 800, events: 2 },
    ],
    disfluencies: { repairs: 3, restarts: 6, prolongations: 9, discourseMarkers: 12 },
    pitch: {
      medianHz: 118,
      p10Hz: 96,
      p90Hz: 148,
      rangeSemitones: 7.5,
      coefficientOfVariation: 0.25,
      declarativesCounted: 8,
      declarativesEndingRising: 2,
    },
    intensity: { medianDb: 62, endOfTurnDropDb: -6.5 },
    responseLatencyMs: 800,
    timeToFirstContentWordMs: 1_400,
    sentenceLengthsWords: [10, 10, 20, 20],
    boundary: 'observation_only_never_competence',
    ...over,
  }
}

function kinematicsOf(over: Partial<KinematicsReport> = {}): KinematicsReport {
  return {
    attemptId: 'attempt-1',
    observedMs: 60_000,
    framesObserved: 1_800,
    framesWithFace: 1_710,
    faceVisibleRatio: 0.95,
    gazeOnCameraRatio: 0.8,
    headPose: { yawDegreesSquared: 12, pitchDegreesSquared: 8, rollDegreesSquared: 4 },
    postureShiftsPerMinute: 3.5,
    gesture: { ratePerMinute: 9, medianAmplitude: 0.4, handsOutOfFrameRatio: 0.1 },
    framing: {
      headroom: 0.18,
      centerOffset: 0.06,
      exposureMedian: 0.55,
      exposureClippedRatio: 0.02,
    },
    boundary: 'observation_only_never_competence',
    ...over,
  }
}

function valueOf(observations: readonly PerformanceObservation[], signal: SignalId): number {
  const found = observations.find((observation) => observation.signal === signal)
  if (found === undefined) throw new Error(`no observation for ${signal}`)
  return found.value
}

function signalsOf(observations: readonly PerformanceObservation[]): SignalId[] {
  return observations.map((observation) => observation.signal)
}

// Four attempts. Articulation rate is words divided by half a minute of speech, so it is twice the
// word count: 120, 80, 150, 200. Low pressure is attempts 1 and 2 (mean 100), high is 3 and 4
// (mean 175). Only attempt 4 followed an interruption.
const SESSION: SessionAttemptInput[] = [
  {
    prosody: prosodyOf({ attemptId: 'attempt-1', words: DRIFTING_WORDS, responseLatencyMs: 800 }),
    pressureLevel: 0,
    followedInterruption: false,
  },
  {
    prosody: prosodyOf({ attemptId: 'attempt-2', words: evenWords(40), responseLatencyMs: 1_200 }),
    pressureLevel: 1,
    followedInterruption: false,
  },
  {
    prosody: prosodyOf({ attemptId: 'attempt-3', words: evenWords(75), responseLatencyMs: 400 }),
    pressureLevel: 2,
    followedInterruption: false,
  },
  {
    prosody: prosodyOf({ attemptId: 'attempt-4', words: evenWords(100), responseLatencyMs: 2_000 }),
    pressureLevel: 3,
    followedInterruption: true,
  },
]

test('a prosody report yields one observation per measurable speech and rhythm signal', () => {
  const observations = observationsFromProsody(prosodyOf())

  expect(signalsOf(observations)).toEqual([
    'articulation_rate',
    'speaking_rate',
    'unfilled_pause_rate',
    'filled_pause_rate',
    'mid_clause_pause_ratio',
    'hesitation_cluster_rate',
    'repair_rate',
    'restart_rate',
    'prolongation_rate',
    'discourse_marker_rate',
    'pitch_range',
    'pitch_variation',
    'terminal_rise_ratio',
    'end_of_turn_loudness_drop',
    'response_latency',
    'time_to_first_content_word',
    'answer_duration',
    'cadence_stability',
    'sentence_length_variation',
  ])

  expect(observations[0]).toEqual({
    attemptId: 'attempt-1',
    signal: 'articulation_rate',
    value: 120,
    unit: 'words_per_minute',
    source: 'prosody',
    boundary: 'observation_only_never_competence',
  })
})

test('every prosody value is the one the report says, not a rescaling of it', () => {
  const observations = observationsFromProsody(prosodyOf())

  expect(valueOf(observations, 'articulation_rate')).toBe(120)
  expect(valueOf(observations, 'speaking_rate')).toBe(60)
  expect(valueOf(observations, 'unfilled_pause_rate')).toBe(2)
  expect(valueOf(observations, 'filled_pause_rate')).toBe(2)
  expect(valueOf(observations, 'mid_clause_pause_ratio')).toBe(0.5)
  expect(valueOf(observations, 'hesitation_cluster_rate')).toBe(3)
  expect(valueOf(observations, 'repair_rate')).toBe(5)
  expect(valueOf(observations, 'restart_rate')).toBe(10)
  expect(valueOf(observations, 'prolongation_rate')).toBe(15)
  expect(valueOf(observations, 'discourse_marker_rate')).toBe(20)
  expect(valueOf(observations, 'pitch_range')).toBe(7.5)
  expect(valueOf(observations, 'pitch_variation')).toBe(0.25)
  expect(valueOf(observations, 'terminal_rise_ratio')).toBe(0.25)
  expect(valueOf(observations, 'end_of_turn_loudness_drop')).toBe(-6.5)
  expect(valueOf(observations, 'response_latency')).toBe(800)
  expect(valueOf(observations, 'time_to_first_content_word')).toBe(1_400)
  expect(valueOf(observations, 'answer_duration')).toBe(60_000)
  expect(valueOf(observations, 'cadence_stability')).toBeCloseTo(0.625, 10)
  expect(valueOf(observations, 'sentence_length_variation')).toBeCloseTo(1 / 3, 10)
})

test('a signal the report cannot support is absent rather than zero', () => {
  const noLatency = observationsFromProsody(
    prosodyOf({ responseLatencyMs: null, timeToFirstContentWordMs: null }),
  )
  expect(signalsOf(noLatency)).not.toContain('response_latency')
  expect(signalsOf(noLatency)).not.toContain('time_to_first_content_word')
  expect(valueOf(noLatency, 'answer_duration')).toBe(60_000)

  const noDeclaratives = observationsFromProsody(
    prosodyOf({
      pitch: { ...prosodyOf().pitch, declarativesCounted: 0, declarativesEndingRising: 0 },
    }),
  )
  expect(signalsOf(noDeclaratives)).not.toContain('terminal_rise_ratio')
  expect(valueOf(noDeclaratives, 'pitch_range')).toBe(7.5)

  const noPauses = observationsFromProsody(prosodyOf({ pauses: [] }))
  expect(signalsOf(noPauses)).not.toContain('mid_clause_pause_ratio')
  expect(signalsOf(noPauses)).not.toContain('cadence_stability')
  expect(valueOf(noPauses, 'articulation_rate')).toBe(60)
})

test('a kinematics report yields one observation per body and framing signal', () => {
  const observations = observationsFromKinematics(kinematicsOf())

  expect(signalsOf(observations)).toEqual([
    'face_visible_ratio',
    'gaze_on_camera_ratio',
    'head_pose_instability',
    'posture_shift_rate',
    'gesture_rate',
    'gesture_amplitude',
    'hands_out_of_frame_ratio',
    'framing_headroom',
    'framing_center_offset',
    'exposure_median',
    'exposure_clipped_ratio',
  ])

  expect(valueOf(observations, 'face_visible_ratio')).toBe(0.95)
  expect(valueOf(observations, 'gaze_on_camera_ratio')).toBe(0.8)
  expect(valueOf(observations, 'head_pose_instability')).toBe(24)
  expect(valueOf(observations, 'posture_shift_rate')).toBe(3.5)
  expect(valueOf(observations, 'gesture_rate')).toBe(9)
  expect(valueOf(observations, 'gesture_amplitude')).toBe(0.4)
  expect(valueOf(observations, 'hands_out_of_frame_ratio')).toBe(0.1)
  expect(valueOf(observations, 'framing_headroom')).toBe(0.18)
  expect(valueOf(observations, 'framing_center_offset')).toBe(0.06)
  expect(valueOf(observations, 'exposure_median')).toBe(0.55)
  expect(valueOf(observations, 'exposure_clipped_ratio')).toBe(0.02)

  expect(observations[2]).toEqual({
    attemptId: 'attempt-1',
    signal: 'head_pose_instability',
    value: 24,
    unit: 'degrees_squared',
    source: 'kinematics',
    boundary: 'observation_only_never_competence',
  })
})

test('a recording with no frames carries no measurement rather than a measurement of zero', () => {
  expect(observationsFromKinematics(kinematicsOf({ framesObserved: 0 }))).toEqual([])
})

test('the four cross-turn signals are measured against the rest of the same session', () => {
  const observations = observationsAcrossSession(SESSION)

  expect(signalsOf(observations)).toEqual([
    'rate_drift_within_answer',
    'rate_drift_within_answer',
    'rate_drift_within_answer',
    'rate_drift_within_answer',
    'interruption_recovery_time',
    'pre_answer_silence',
    'pre_answer_silence',
    'pre_answer_silence',
    'rate_change_under_pressure',
    'rate_change_under_pressure',
  ])

  const drift = observations.filter(
    (observation) => observation.signal === 'rate_drift_within_answer',
  )
  expect(drift.map((observation) => observation.attemptId)).toEqual([
    'attempt-1',
    'attempt-2',
    'attempt-3',
    'attempt-4',
  ])
  expect(drift[0]?.value).toBeCloseTo(3, 10)
  expect(drift[1]?.value).toBeCloseTo(1, 10)
  expect(drift[3]?.value).toBeCloseTo(1, 10)

  const recovery = observations.filter(
    (observation) => observation.signal === 'interruption_recovery_time',
  )
  expect(recovery).toEqual([
    {
      attemptId: 'attempt-4',
      signal: 'interruption_recovery_time',
      value: 2_000,
      unit: 'milliseconds',
      source: 'prosody',
      boundary: 'observation_only_never_competence',
    },
  ])

  const silence = observations.filter((observation) => observation.signal === 'pre_answer_silence')
  expect(silence.map((observation) => [observation.attemptId, observation.value])).toEqual([
    ['attempt-1', 800],
    ['attempt-2', 1_200],
    ['attempt-3', 400],
  ])

  const underPressure = observations.filter(
    (observation) => observation.signal === 'rate_change_under_pressure',
  )
  expect(underPressure.map((observation) => observation.attemptId)).toEqual([
    'attempt-3',
    'attempt-4',
  ])
  expect(underPressure[0]?.value).toBeCloseTo(1.5, 10)
  expect(underPressure[1]?.value).toBeCloseTo(2, 10)
})

test('a session with no low-pressure answer has nothing to compare a high-pressure one against', () => {
  const allHigh = SESSION.map((attempt) => ({ ...attempt, pressureLevel: 3 }))

  expect(signalsOf(observationsAcrossSession(allHigh))).not.toContain('rate_change_under_pressure')
  expect(contrastsAcrossSession(allHigh).map((contrast) => contrast.contrast)).toEqual([
    'early_vs_late_in_answer',
    'before_vs_after_interruption',
  ])
})

test('the three within-session contrasts carry both sides, not just the ratio', () => {
  const contrasts = contrastsAcrossSession(SESSION)

  expect(contrasts.map((contrast) => contrast.contrast)).toEqual([
    'early_vs_late_in_answer',
    'low_vs_high_pressure',
    'before_vs_after_interruption',
  ])

  const [early, pressure, interruption] = contrasts

  expect(early?.signal).toBe('rate_drift_within_answer')
  expect(early?.earlier).toBeCloseTo(100, 8)
  expect(early?.later).toBeCloseTo(150, 8)
  expect(early?.ratio).toBeCloseTo(1.5, 10)
  expect(early?.attemptIds).toEqual(['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'])

  expect(pressure?.signal).toBe('rate_change_under_pressure')
  expect(pressure?.earlier).toBeCloseTo(100, 10)
  expect(pressure?.later).toBeCloseTo(175, 10)
  expect(pressure?.ratio).toBeCloseTo(1.75, 10)
  expect(pressure?.attemptIds).toEqual(['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'])

  expect(interruption?.signal).toBe('interruption_recovery_time')
  expect(interruption?.earlier).toBeCloseTo(800, 10)
  expect(interruption?.later).toBeCloseTo(2_000, 10)
  expect(interruption?.ratio).toBeCloseTo(2.5, 10)
  expect(interruption?.attemptIds).toEqual(['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4'])
})

test('a session with nobody interrupted raises no interruption contrast', () => {
  const uninterrupted = SESSION.map((attempt) => ({ ...attempt, followedInterruption: false }))
  const contrasts = contrastsAcrossSession(uninterrupted)

  expect(contrasts.map((contrast) => contrast.contrast)).toEqual([
    'early_vs_late_in_answer',
    'low_vs_high_pressure',
  ])
})

// The registry is the complete list of what Levelhead is willing to measure. A signal declared there
// and produced by nothing is a column that is always empty, and the table exists to make that
// visible rather than to be audited by hand.
test('every signal in the registry is produced by one of the three observation functions', () => {
  const produced = new Set(
    [
      ...observationsFromProsody(prosodyOf()),
      ...observationsFromKinematics(kinematicsOf()),
      ...observationsAcrossSession(SESSION),
    ].map((observation) => observation.signal),
  )

  expect([...SIGNAL_IDS].filter((signal) => !produced.has(signal))).toEqual([])
  expect(produced.size).toBe(SIGNAL_IDS.length)
})

// A wrong unit is invisible until it reaches a chart, where it becomes a lie about the candidate.
test('every observation carries the unit its signal declares', () => {
  const observations = [
    ...observationsFromProsody(prosodyOf()),
    ...observationsFromKinematics(kinematicsOf()),
    ...observationsAcrossSession(SESSION),
  ]

  const mismatched = observations.filter(
    (observation) => observation.unit !== SIGNALS[observation.signal].unit,
  )
  expect(mismatched).toEqual([])

  const unitOf = (signal: SignalId): string => {
    const found = observations.find((observation) => observation.signal === signal)
    if (found === undefined) throw new Error(`no observation for ${signal}`)
    return found.unit
  }

  expect(unitOf('articulation_rate')).toBe('words_per_minute')
  expect(unitOf('answer_duration')).toBe('milliseconds')
  expect(unitOf('mid_clause_pause_ratio')).toBe('ratio')
  expect(unitOf('filled_pause_rate')).toBe('per_minute')
  expect(unitOf('repair_rate')).toBe('per_hundred_words')
  expect(unitOf('pitch_range')).toBe('semitones')
  expect(unitOf('end_of_turn_loudness_drop')).toBe('decibels')
  expect(unitOf('head_pose_instability')).toBe('degrees_squared')
  expect(unitOf('rate_change_under_pressure')).toBe('ratio')
  expect(unitOf('interruption_recovery_time')).toBe('milliseconds')
})

test('observing a report leaves it untouched', () => {
  const report = prosodyOf()
  observationsFromProsody(report)
  observationsAcrossSession(SESSION)

  expect(report).toEqual(prosodyOf())
  expect(SESSION[0]?.prosody.words.length).toBe(60)
})
