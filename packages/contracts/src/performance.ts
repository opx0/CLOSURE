import { Type, type Static } from '@sinclair/typebox'

// The performance lane's boundary value, carried on every shape that crosses a process or a wire,
// so it stays labelled wherever it travels. The competence lane's equivalent is a Finding's rubric
// reference; these two never meet.
export const PERFORMANCE_BOUNDARY = 'observation_only_never_competence' as const

export const SignalFamilySchema = Type.Union([
  Type.Literal('speech'),
  Type.Literal('rhythm'),
  Type.Literal('kinematics'),
])
export type SignalFamily = Static<typeof SignalFamilySchema>

export const PerformanceUnitSchema = Type.Union([
  Type.Literal('words_per_minute'),
  Type.Literal('milliseconds'),
  Type.Literal('ratio'),
  Type.Literal('per_minute'),
  Type.Literal('per_hundred_words'),
  Type.Literal('semitones'),
  Type.Literal('decibels'),
  Type.Literal('degrees_squared'),
])
export type PerformanceUnit = Static<typeof PerformanceUnitSchema>

export const SignalIdSchema = Type.Union([
  Type.Literal('articulation_rate'),
  Type.Literal('speaking_rate'),
  Type.Literal('unfilled_pause_rate'),
  Type.Literal('filled_pause_rate'),
  Type.Literal('mid_clause_pause_ratio'),
  Type.Literal('hesitation_cluster_rate'),
  Type.Literal('repair_rate'),
  Type.Literal('restart_rate'),
  Type.Literal('prolongation_rate'),
  Type.Literal('discourse_marker_rate'),
  Type.Literal('pitch_range'),
  Type.Literal('pitch_variation'),
  Type.Literal('terminal_rise_ratio'),
  Type.Literal('end_of_turn_loudness_drop'),
  Type.Literal('response_latency'),
  Type.Literal('time_to_first_content_word'),
  Type.Literal('answer_duration'),
  Type.Literal('rate_drift_within_answer'),
  Type.Literal('cadence_stability'),
  Type.Literal('sentence_length_variation'),
  Type.Literal('interruption_recovery_time'),
  Type.Literal('pre_answer_silence'),
  Type.Literal('rate_change_under_pressure'),
  Type.Literal('face_visible_ratio'),
  Type.Literal('gaze_on_camera_ratio'),
  Type.Literal('head_pose_instability'),
  Type.Literal('posture_shift_rate'),
  Type.Literal('gesture_rate'),
  Type.Literal('gesture_amplitude'),
  Type.Literal('hands_out_of_frame_ratio'),
  Type.Literal('framing_headroom'),
  Type.Literal('framing_center_offset'),
  Type.Literal('exposure_median'),
  Type.Literal('exposure_clipped_ratio'),
])
export type SignalId = Static<typeof SignalIdSchema>

export interface ReferenceBand {
  readonly low: number
  readonly high: number
  readonly source: string
}

export interface SignalSpec {
  readonly id: SignalId
  readonly family: SignalFamily
  readonly label: string
  readonly unit: PerformanceUnit
  // Null on every signal, deliberately. A band is an authority claim, and no published band for any
  // of these is specific enough to an engineering interview to cite honestly. The field exists so a
  // sourced band can be added with its citation rather than invented; until one is, every comparison
  // is the candidate against their own baseline or against the same session's other turns.
  readonly reference: ReferenceBand | null
}

function speech(id: SignalId, label: string, unit: PerformanceUnit): SignalSpec {
  return { id, family: 'speech', label, unit, reference: null }
}
function rhythm(id: SignalId, label: string, unit: PerformanceUnit): SignalSpec {
  return { id, family: 'rhythm', label, unit, reference: null }
}
function kinematics(id: SignalId, label: string, unit: PerformanceUnit): SignalSpec {
  return { id, family: 'kinematics', label, unit, reference: null }
}

// One registry, so the debrief, the trend series, the note detector and the drill generator all
// iterate the same table instead of each growing a parallel switch over signal ids.
export const SIGNALS: Readonly<Record<SignalId, SignalSpec>> = {
  articulation_rate: speech(
    'articulation_rate',
    'tempo while actually speaking',
    'words_per_minute',
  ),
  speaking_rate: speech('speaking_rate', 'tempo including pauses', 'words_per_minute'),
  unfilled_pause_rate: speech('unfilled_pause_rate', 'silent pauses', 'per_minute'),
  filled_pause_rate: speech('filled_pause_rate', 'pauses filled with a sound', 'per_minute'),
  mid_clause_pause_ratio: speech(
    'mid_clause_pause_ratio',
    'pauses landing mid-clause rather than at a clause boundary',
    'ratio',
  ),
  hesitation_cluster_rate: speech(
    'hesitation_cluster_rate',
    'runs of stacked hesitation',
    'per_minute',
  ),
  repair_rate: speech('repair_rate', 'self-corrections', 'per_hundred_words'),
  restart_rate: speech('restart_rate', 'abandoned and restarted clauses', 'per_hundred_words'),
  prolongation_rate: speech('prolongation_rate', 'stretched words', 'per_hundred_words'),
  discourse_marker_rate: speech('discourse_marker_rate', 'discourse markers', 'per_hundred_words'),
  pitch_range: speech('pitch_range', 'pitch range', 'semitones'),
  pitch_variation: speech('pitch_variation', 'pitch variation', 'ratio'),
  terminal_rise_ratio: speech(
    'terminal_rise_ratio',
    'statements ending on a rising pitch',
    'ratio',
  ),
  end_of_turn_loudness_drop: speech(
    'end_of_turn_loudness_drop',
    'trailing off at the end',
    'decibels',
  ),
  response_latency: speech('response_latency', 'silence before the first word', 'milliseconds'),
  time_to_first_content_word: speech(
    'time_to_first_content_word',
    'time before the first word that is not a filler or a marker',
    'milliseconds',
  ),
  answer_duration: speech('answer_duration', 'answer length', 'milliseconds'),
  rate_drift_within_answer: rhythm(
    'rate_drift_within_answer',
    'tempo in the last third against the first third of an answer',
    'ratio',
  ),
  cadence_stability: rhythm('cadence_stability', 'evenness of the gaps between phrases', 'ratio'),
  sentence_length_variation: rhythm(
    'sentence_length_variation',
    'variation in sentence length',
    'ratio',
  ),
  interruption_recovery_time: rhythm(
    'interruption_recovery_time',
    'time to resume speaking after being cut off',
    'milliseconds',
  ),
  pre_answer_silence: rhythm('pre_answer_silence', 'silence before answering', 'milliseconds'),
  rate_change_under_pressure: rhythm(
    'rate_change_under_pressure',
    'tempo at high pressure against tempo at low pressure',
    'ratio',
  ),
  face_visible_ratio: kinematics('face_visible_ratio', 'frames with a detectable face', 'ratio'),
  gaze_on_camera_ratio: kinematics('gaze_on_camera_ratio', 'frames facing the lens', 'ratio'),
  head_pose_instability: kinematics('head_pose_instability', 'head movement', 'degrees_squared'),
  posture_shift_rate: kinematics('posture_shift_rate', 'posture shifts', 'per_minute'),
  gesture_rate: kinematics('gesture_rate', 'hand gestures', 'per_minute'),
  gesture_amplitude: kinematics('gesture_amplitude', 'gesture size', 'ratio'),
  hands_out_of_frame_ratio: kinematics(
    'hands_out_of_frame_ratio',
    'frames with hands out of shot',
    'ratio',
  ),
  framing_headroom: kinematics('framing_headroom', 'space above the head', 'ratio'),
  framing_center_offset: kinematics(
    'framing_center_offset',
    'offset from the centre of frame',
    'ratio',
  ),
  exposure_median: kinematics('exposure_median', 'brightness', 'ratio'),
  exposure_clipped_ratio: kinematics(
    'exposure_clipped_ratio',
    'blown-out or crushed pixels',
    'ratio',
  ),
}

export const SIGNAL_IDS: readonly SignalId[] = Object.keys(SIGNALS) as SignalId[]

export const ObservationSourceSchema = Type.Union([
  Type.Literal('prosody'),
  Type.Literal('kinematics'),
])
export type ObservationSource = Static<typeof ObservationSourceSchema>

// Noticed, never judged (CONTEXT.md). One signal's value for one attempt, and nothing else.
export const PerformanceObservationSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  signal: SignalIdSchema,
  value: Type.Number(),
  unit: PerformanceUnitSchema,
  source: ObservationSourceSchema,
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})
export type PerformanceObservation = Static<typeof PerformanceObservationSchema>

export const PerformanceBaselineSchema = Type.Object({
  signal: SignalIdSchema,
  n: Type.Integer({ minimum: 1 }),
  median: Type.Number(),
  p25: Type.Number(),
  p75: Type.Number(),
  earliestAt: Type.String({ format: 'date-time' }),
  latestAt: Type.String({ format: 'date-time' }),
})
export type PerformanceBaseline = Static<typeof PerformanceBaselineSchema>

export const WithinSessionContrastSchema = Type.Union([
  Type.Literal('early_vs_late_in_answer'),
  Type.Literal('low_vs_high_pressure'),
  Type.Literal('before_vs_after_interruption'),
])
export type WithinSessionContrast = Static<typeof WithinSessionContrastSchema>

// A union rather than a bag of optionals: a note is raised by exactly one mechanism, and which one
// decides what the debrief is allowed to say about it.
export const NoteTriggerSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('baseline_drift'),
    baseline: PerformanceBaselineSchema,
    observed: Type.Number(),
    direction: Type.Union([Type.Literal('above'), Type.Literal('below')]),
  }),
  Type.Object({
    kind: Type.Literal('within_session_contrast'),
    contrast: WithinSessionContrastSchema,
    earlier: Type.Number(),
    later: Type.Number(),
    ratio: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal('reference_breach'),
    low: Type.Number(),
    high: Type.Number(),
    source: Type.String({ minLength: 1 }),
    observed: Type.Number(),
  }),
])
export type NoteTrigger = Static<typeof NoteTriggerSchema>

// The performance lane's answer to "no finding without evidence": no note without the observations
// that raised it. `minItems: 1` is the runtime half; the tuple type below is the compile-time half.
export const PerformanceNoteSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  signal: SignalIdSchema,
  family: SignalFamilySchema,
  summary: Type.String({ minLength: 1 }),
  trigger: NoteTriggerSchema,
  observationAttemptIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})

type NonEmpty<T> = readonly [T, ...T[]]
export type PerformanceNote = Omit<
  Static<typeof PerformanceNoteSchema>,
  'observationAttemptIds'
> & { readonly observationAttemptIds: NonEmpty<string> }

export const PerformanceDrillSchema = Type.Object({
  noteId: Type.String({ minLength: 1 }),
  signal: SignalIdSchema,
  instruction: Type.String({ minLength: 1 }),
  // The drill is only worth running if the same signal is measured again next session.
  retestSignal: SignalIdSchema,
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})
export type PerformanceDrill = Static<typeof PerformanceDrillSchema>
