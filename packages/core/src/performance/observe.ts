import {
  PERFORMANCE_BOUNDARY,
  SIGNALS,
  SIGNAL_IDS,
  type KinematicsReport,
  type ObservationSource,
  type PerformanceObservation,
  type ProsodyReport,
  type SignalId,
  type WithinSessionContrast,
} from '@levelhead/contracts'

// One constructor for every observation, so the unit is read off the registry and can never be a
// call-site choice. A value paired with the wrong unit is a lie the moment it reaches a chart.
function observationOf(
  attemptId: string,
  signal: SignalId,
  value: number,
  source: ObservationSource,
): PerformanceObservation {
  return {
    attemptId,
    signal,
    value,
    unit: SIGNALS[signal].unit,
    source,
    boundary: PERFORMANCE_BOUNDARY,
  }
}

// A null return means "not measurable from this report", which emits nothing rather than a zero.
type Extractor<R> = (report: R) => number | null
type SignalTable<R> = Partial<Record<SignalId, Extractor<R>>>

// PROSODY_SIGNALS, KINEMATICS_SIGNALS and the four signals in observationsAcrossSession partition
// SIGNAL_IDS exactly. The relation test in observe.test.ts is what holds that true: a signal in the
// registry that no function produces would be a column that is always empty.
function observationsFrom<R extends { attemptId: string }>(
  report: R,
  table: SignalTable<R>,
  source: ObservationSource,
): PerformanceObservation[] {
  const out: PerformanceObservation[] = []
  for (const signal of SIGNAL_IDS) {
    const measure = table[signal]
    if (measure === undefined) continue
    const value = measure(report)
    if (value !== null) out.push(observationOf(report.attemptId, signal, value, source))
  }
  return out
}

function perMinute(count: number, ms: number): number | null {
  return ms > 0 ? count / (ms / 60_000) : null
}

function perHundredWords(count: number, words: number): number | null {
  return words > 0 ? (count / words) * 100 : null
}

function ratioOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// Population standard deviation over the mean: the values are the whole answer, not a sample drawn
// from it, so there is no Bessel correction to make.
function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const avg = mean(values)
  if (avg === null || avg <= 0) return null
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance) / avg
}

function speakingMs(report: ProsodyReport): number {
  const paused = report.pauses.reduce((sum, pause) => sum + pause.durationMs, 0)
  return Math.max(0, report.audioMs - paused)
}

function wordsPerMinute(words: number, ms: number): number | null {
  return ms > 0 ? words / (ms / 60_000) : null
}

const PROSODY_SIGNALS: SignalTable<ProsodyReport> = {
  articulation_rate: (report) => wordsPerMinute(report.words.length, speakingMs(report)),
  speaking_rate: (report) => wordsPerMinute(report.words.length, report.audioMs),
  unfilled_pause_rate: (report) =>
    perMinute(report.pauses.filter((pause) => pause.kind === 'unfilled').length, report.audioMs),
  filled_pause_rate: (report) =>
    perMinute(report.pauses.filter((pause) => pause.kind === 'filled').length, report.audioMs),
  mid_clause_pause_ratio: (report) =>
    ratioOf(
      report.pauses.filter((pause) => pause.position === 'mid_clause').length,
      report.pauses.length,
    ),
  hesitation_cluster_rate: (report) => perMinute(report.hesitationClusters.length, report.audioMs),
  repair_rate: (report) => perHundredWords(report.disfluencies.repairs, report.words.length),
  restart_rate: (report) => perHundredWords(report.disfluencies.restarts, report.words.length),
  prolongation_rate: (report) =>
    perHundredWords(report.disfluencies.prolongations, report.words.length),
  discourse_marker_rate: (report) =>
    perHundredWords(report.disfluencies.discourseMarkers, report.words.length),
  pitch_range: (report) => report.pitch.rangeSemitones,
  pitch_variation: (report) => report.pitch.coefficientOfVariation,
  terminal_rise_ratio: (report) =>
    ratioOf(report.pitch.declarativesEndingRising, report.pitch.declarativesCounted),
  end_of_turn_loudness_drop: (report) => report.intensity.endOfTurnDropDb,
  response_latency: (report) => report.responseLatencyMs,
  time_to_first_content_word: (report) => report.timeToFirstContentWordMs,
  answer_duration: (report) => report.audioMs,
  // A phrase is a run of speech between two pauses, so the gaps between phrases are the pauses.
  // 1 / (1 + cv) is a bounded rescaling of their coefficient of variation: 1 is perfectly even, and
  // the measure never saturates the way a clamped 1 - cv would.
  cadence_stability: (report) => {
    const cv = coefficientOfVariation(report.pauses.map((pause) => pause.durationMs))
    return cv === null ? null : 1 / (1 + cv)
  },
  sentence_length_variation: (report) => coefficientOfVariation(report.sentenceLengthsWords),
}

const KINEMATICS_SIGNALS: SignalTable<KinematicsReport> = {
  face_visible_ratio: (report) => report.faceVisibleRatio,
  gaze_on_camera_ratio: (report) => report.gazeOnCameraRatio,
  // A total variance over three orthogonal axes, in the one physical quantity the registry declares
  // (degrees squared). Not a combination of separate signals.
  head_pose_instability: (report) =>
    report.headPose.yawDegreesSquared +
    report.headPose.pitchDegreesSquared +
    report.headPose.rollDegreesSquared,
  posture_shift_rate: (report) => report.postureShiftsPerMinute,
  gesture_rate: (report) => report.gesture.ratePerMinute,
  gesture_amplitude: (report) => report.gesture.medianAmplitude,
  hands_out_of_frame_ratio: (report) => report.gesture.handsOutOfFrameRatio,
  framing_headroom: (report) => report.framing.headroom,
  framing_center_offset: (report) => report.framing.centerOffset,
  exposure_median: (report) => report.framing.exposureMedian,
  exposure_clipped_ratio: (report) => report.framing.exposureClippedRatio,
}

export function observationsFromProsody(report: ProsodyReport): PerformanceObservation[] {
  return observationsFrom(report, PROSODY_SIGNALS, 'prosody')
}

export function observationsFromKinematics(report: KinematicsReport): PerformanceObservation[] {
  // Every ratio above has frames in its denominator. A report over no frames carries no measurement
  // rather than a measurement of zero.
  if (report.framesObserved === 0) return []
  return observationsFrom(report, KINEMATICS_SIGNALS, 'kinematics')
}

// Plain data. The pressure level and the interruption flag are read from the session's own events by
// the caller; this module never reaches into the policy that produced them.
export interface SessionAttemptInput {
  readonly prosody: ProsodyReport
  // 0 to 3, the range PressureLevelSchema declares.
  readonly pressureLevel: number
  readonly followedInterruption: boolean
}

// Detection parameter, not a finding: the midpoint of the 0..3 pressure range, so "high" is the top
// half of what the session could have applied. It decides which attempts form the high-pressure
// group and nothing else.
export const HIGH_PRESSURE_FROM = 2

interface AnswerThirds {
  readonly firstThirdWpm: number
  readonly lastThirdWpm: number
}

// Split by word index, not by time, so a long pause inside an answer does not move the boundary.
export function answerThirds(report: ProsodyReport): AnswerThirds | null {
  const words = report.words
  if (words.length < 3) return null
  const size = Math.floor(words.length / 3)
  const first = words.slice(0, size)
  const last = words.slice(words.length - size)

  const wpmOf = (slice: typeof words): number | null => {
    const start = slice[0]
    const end = slice[slice.length - 1]
    if (start === undefined || end === undefined) return null
    const elapsed = end.endMs - start.startMs
    return elapsed > 0 ? slice.length / (elapsed / 60_000) : null
  }

  const firstThirdWpm = wpmOf(first)
  const lastThirdWpm = wpmOf(last)
  if (firstThirdWpm === null || lastThirdWpm === null) return null
  return { firstThirdWpm, lastThirdWpm }
}

function articulationRateOf(report: ProsodyReport): number | null {
  return wordsPerMinute(report.words.length, speakingMs(report))
}

export function observationsAcrossSession(
  input: readonly SessionAttemptInput[],
): PerformanceObservation[] {
  const out: PerformanceObservation[] = []

  for (const attempt of input) {
    const thirds = answerThirds(attempt.prosody)
    if (thirds !== null && thirds.firstThirdWpm > 0) {
      out.push(
        observationOf(
          attempt.prosody.attemptId,
          'rate_drift_within_answer',
          thirds.lastThirdWpm / thirds.firstThirdWpm,
          'prosody',
        ),
      )
    }
  }

  // interruption_recovery_time and pre_answer_silence partition the session's response latencies by
  // whether the attempt followed an interruption, so the silence before an ordinary answer is never
  // averaged in with the time taken to recover from being cut off. The unpartitioned latency is the
  // response_latency signal in the prosody table, which is what a per-attempt trend wants.
  for (const attempt of input) {
    const latency = attempt.prosody.responseLatencyMs
    if (attempt.followedInterruption && latency !== null) {
      out.push(
        observationOf(attempt.prosody.attemptId, 'interruption_recovery_time', latency, 'prosody'),
      )
    }
  }
  for (const attempt of input) {
    const latency = attempt.prosody.responseLatencyMs
    if (!attempt.followedInterruption && latency !== null) {
      out.push(observationOf(attempt.prosody.attemptId, 'pre_answer_silence', latency, 'prosody'))
    }
  }

  // The comparison is against the candidate's own low-pressure tempo in the same session, because no
  // external band exists to compare it to.
  const lowRates = input
    .filter((attempt) => attempt.pressureLevel < HIGH_PRESSURE_FROM)
    .map((attempt) => articulationRateOf(attempt.prosody))
    .filter((rate): rate is number => rate !== null)
  const low = mean(lowRates)
  if (low !== null && low > 0) {
    for (const attempt of input) {
      if (attempt.pressureLevel < HIGH_PRESSURE_FROM) continue
      const rate = articulationRateOf(attempt.prosody)
      if (rate === null) continue
      out.push(
        observationOf(
          attempt.prosody.attemptId,
          'rate_change_under_pressure',
          rate / low,
          'prosody',
        ),
      )
    }
  }

  return out
}

export interface SessionContrast {
  readonly contrast: WithinSessionContrast
  readonly signal: SignalId
  readonly earlier: number
  readonly later: number
  readonly ratio: number
  readonly attemptIds: readonly [string, ...string[]]
}

function contrastOf(
  contrast: WithinSessionContrast,
  signal: SignalId,
  earlier: number | null,
  later: number | null,
  attemptIds: readonly string[],
): SessionContrast | null {
  const [first, ...rest] = attemptIds
  if (first === undefined) return null
  if (earlier === null || later === null || earlier <= 0) return null
  return {
    contrast,
    signal,
    earlier,
    later,
    ratio: later / earlier,
    attemptIds: [first, ...rest],
  }
}

// The pairs behind the contrast notes, computed here rather than in notes.ts so the split into
// thirds and the pressure split are decided once.
export function contrastsAcrossSession(input: readonly SessionAttemptInput[]): SessionContrast[] {
  const out: SessionContrast[] = []

  const withThirds = input
    .map((attempt) => ({ id: attempt.prosody.attemptId, thirds: answerThirds(attempt.prosody) }))
    .filter((row): row is { id: string; thirds: AnswerThirds } => row.thirds !== null)
  const early = contrastOf(
    'early_vs_late_in_answer',
    'rate_drift_within_answer',
    mean(withThirds.map((row) => row.thirds.firstThirdWpm)),
    mean(withThirds.map((row) => row.thirds.lastThirdWpm)),
    withThirds.map((row) => row.id),
  )
  if (early !== null) out.push(early)

  const lowGroup = input.filter((attempt) => attempt.pressureLevel < HIGH_PRESSURE_FROM)
  const highGroup = input.filter((attempt) => attempt.pressureLevel >= HIGH_PRESSURE_FROM)
  const rateOf = (attempts: readonly SessionAttemptInput[]): number | null =>
    mean(
      attempts
        .map((attempt) => articulationRateOf(attempt.prosody))
        .filter((rate): rate is number => rate !== null),
    )
  const pressure = contrastOf(
    'low_vs_high_pressure',
    'rate_change_under_pressure',
    rateOf(lowGroup),
    rateOf(highGroup),
    [...lowGroup, ...highGroup].map((attempt) => attempt.prosody.attemptId),
  )
  if (pressure !== null) out.push(pressure)

  const notInterrupted = input.filter(
    (attempt) => !attempt.followedInterruption && attempt.prosody.responseLatencyMs !== null,
  )
  const interrupted = input.filter(
    (attempt) => attempt.followedInterruption && attempt.prosody.responseLatencyMs !== null,
  )
  const latencyOf = (attempts: readonly SessionAttemptInput[]): number | null =>
    mean(
      attempts
        .map((attempt) => attempt.prosody.responseLatencyMs)
        .filter((latency): latency is number => latency !== null),
    )
  const interruption = contrastOf(
    'before_vs_after_interruption',
    'interruption_recovery_time',
    latencyOf(notInterrupted),
    latencyOf(interrupted),
    [...notInterrupted, ...interrupted].map((attempt) => attempt.prosody.attemptId),
  )
  if (interruption !== null) out.push(interruption)

  return out
}
