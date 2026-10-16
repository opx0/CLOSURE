import {
  PERFORMANCE_BOUNDARY,
  SIGNALS,
  SIGNAL_IDS,
  type PerformanceBaseline,
  type PerformanceNote,
  type PerformanceObservation,
  type PerformanceUnit,
  type WithinSessionContrast,
} from '@levelhead/contracts'
import { medianOf } from './baseline.ts'
import { HIGH_PRESSURE_FROM, type SessionContrast } from './observe.ts'

export interface NotesInput {
  readonly observations: readonly PerformanceObservation[]
  readonly baselines: readonly PerformanceBaseline[]
  readonly contrasts: readonly SessionContrast[]
}

// Detection parameter. Tukey's fence around the middle half of the candidate's own past values: a
// value more than 1.5 interquartile ranges outside p25..p75 is far enough from where they normally
// land to be worth showing them. It is a sensitivity knob on their own distribution and not a claim
// about any population.
export const FENCE_IQR_MULTIPLIER = 1.5

// Detection parameter. A baseline over fewer than three past observations is not a distribution, so
// nothing is raised against it and the caller reports the baseline as not established yet.
export const MIN_BASELINE_N = 3

// Detection parameter. Two conditions in one session have to differ by a quarter before the
// difference is shown, in either direction: the test is ratio >= 1.25 or ratio <= 1 / 1.25, so
// speeding up and slowing down are treated alike. Chosen as the sensitivity of the detector, not as
// a threshold anyone has measured to matter.
export const CONTRAST_RATIO_THRESHOLD = 1.25

// Complete records over PerformanceUnit, so a new unit in the registry fails to compile here until
// it is given a spelling.
const UNIT_DECIMALS: Record<PerformanceUnit, number> = {
  words_per_minute: 0,
  milliseconds: 0,
  ratio: 2,
  per_minute: 1,
  per_hundred_words: 1,
  semitones: 1,
  decibels: 1,
  degrees_squared: 1,
}

const UNIT_SUFFIX: Record<PerformanceUnit, string> = {
  words_per_minute: ' words/min',
  milliseconds: ' ms',
  ratio: '',
  per_minute: ' per minute',
  per_hundred_words: ' per 100 words',
  semitones: ' semitones',
  decibels: ' dB',
  degrees_squared: ' deg²',
}

function formatValue(value: number, unit: PerformanceUnit): string {
  return `${value.toFixed(UNIT_DECIMALS[unit])}${UNIT_SUFFIX[unit]}`
}

// The unit reads once, on the range, rather than on each bound: "120 to 160 words/min".
function formatRange(low: number, high: number, unit: PerformanceUnit): string {
  const decimals = UNIT_DECIMALS[unit]
  return `${low.toFixed(decimals)} to ${high.toFixed(decimals)}${UNIT_SUFFIX[unit]}`
}

function answerCount(k: number): string {
  return `${k} ${k === 1 ? 'answer' : 'answers'}`
}

// Every summary states the two numbers and their ratio and stops there. A summary that explained why
// the numbers moved would be a judgment, and the performance lane does not judge. The first two
// contrasts are tempo contrasts whose two sides are words per minute even though their signal's own
// unit is ratio, which is why each summary names the unit rather than reading it off the signal.
const CONTRAST_SUMMARY: Record<WithinSessionContrast, (contrast: SessionContrast) => string> = {
  early_vs_late_in_answer: (contrast) =>
    `the last third of your answers ran at ${formatValue(contrast.later, 'words_per_minute')} against ${formatValue(contrast.earlier, 'words_per_minute')} in the first third, a ratio of ${contrast.ratio.toFixed(2)} across ${answerCount(contrast.attemptIds.length)}.`,
  low_vs_high_pressure: (contrast) =>
    `at pressure ${HIGH_PRESSURE_FROM} and above you ran ${formatValue(contrast.later, 'words_per_minute')} against ${formatValue(contrast.earlier, 'words_per_minute')} below it, a ratio of ${contrast.ratio.toFixed(2)} across ${answerCount(contrast.attemptIds.length)}.`,
  before_vs_after_interruption: (contrast) =>
    `after an interruption you began speaking after ${formatValue(contrast.later, 'milliseconds')} against ${formatValue(contrast.earlier, 'milliseconds')} on answers that were not interrupted, a ratio of ${contrast.ratio.toFixed(2)} across ${answerCount(contrast.attemptIds.length)}.`,
}

function nonEmpty(ids: readonly string[]): readonly [string, ...string[]] | null {
  const [first, ...rest] = ids
  return first === undefined ? null : [first, ...rest]
}

function referenceBreaches(observations: readonly PerformanceObservation[]): PerformanceNote[] {
  const out: PerformanceNote[] = []
  for (const signal of SIGNAL_IDS) {
    const spec = SIGNALS[signal]
    // reference is null on every entry in SIGNALS today, for the reason performance.ts gives, so this
    // branch does not run. It is written so that adding one sourced band to the registry is the whole
    // change with no new code here, and so the band's own citation travels into the note instead of
    // being retyped.
    const band = spec.reference
    if (band === null) continue

    const breaching = observations.filter(
      (observation) =>
        observation.signal === signal &&
        (observation.value < band.low || observation.value > band.high),
    )
    const attemptIds = nonEmpty(breaching.map((observation) => observation.attemptId))
    if (attemptIds === null) continue

    const observed = medianOf(breaching.map((observation) => observation.value))
    out.push({
      id: `reference_breach:${signal}`,
      signal,
      family: spec.family,
      summary: `${spec.label} ran ${formatValue(observed, spec.unit)}, outside the ${formatRange(band.low, band.high, spec.unit)} band published by ${band.source}.`,
      trigger: {
        kind: 'reference_breach',
        low: band.low,
        high: band.high,
        source: band.source,
        observed,
      },
      observationAttemptIds: attemptIds,
      boundary: PERFORMANCE_BOUNDARY,
    })
  }
  return out
}

function baselineDrifts(
  observations: readonly PerformanceObservation[],
  baselines: readonly PerformanceBaseline[],
): PerformanceNote[] {
  const bySignal = new Map(baselines.map((baseline) => [baseline.signal, baseline]))
  const out: PerformanceNote[] = []

  for (const signal of SIGNAL_IDS) {
    const baseline = bySignal.get(signal)
    if (baseline === undefined || baseline.n < MIN_BASELINE_N) continue

    const iqr = baseline.p75 - baseline.p25
    const lowFence = baseline.p25 - FENCE_IQR_MULTIPLIER * iqr
    const highFence = baseline.p75 + FENCE_IQR_MULTIPLIER * iqr
    // When the past values are identical the fence collapses onto them and any different value reads
    // as drift; that is the honest answer for a baseline that has never moved, not a bug.

    const forSignal = observations.filter((observation) => observation.signal === signal)
    const spec = SIGNALS[signal]

    for (const direction of ['above', 'below'] as const) {
      const group = forSignal.filter((observation) =>
        direction === 'above' ? observation.value > highFence : observation.value < lowFence,
      )
      const attemptIds = nonEmpty(group.map((observation) => observation.attemptId))
      if (attemptIds === null) continue

      const observed = medianOf(group.map((observation) => observation.value))
      out.push({
        id: `baseline_drift:${signal}:${direction}`,
        signal,
        family: spec.family,
        summary: `${spec.label} ran ${formatValue(observed, spec.unit)} across ${answerCount(group.length)} this session, ${direction} your own middle half of ${formatRange(baseline.p25, baseline.p75, spec.unit)} over ${baseline.n} past observations (median ${formatValue(baseline.median, spec.unit)}).`,
        trigger: { kind: 'baseline_drift', baseline, observed, direction },
        observationAttemptIds: attemptIds,
        boundary: PERFORMANCE_BOUNDARY,
      })
    }
  }
  return out
}

function contrastNotes(contrasts: readonly SessionContrast[]): PerformanceNote[] {
  const out: PerformanceNote[] = []
  for (const contrast of contrasts) {
    const far =
      contrast.ratio >= CONTRAST_RATIO_THRESHOLD || contrast.ratio <= 1 / CONTRAST_RATIO_THRESHOLD
    if (!far) continue

    out.push({
      id: `within_session_contrast:${contrast.contrast}`,
      signal: contrast.signal,
      family: SIGNALS[contrast.signal].family,
      summary: CONTRAST_SUMMARY[contrast.contrast](contrast),
      trigger: {
        kind: 'within_session_contrast',
        contrast: contrast.contrast,
        earlier: contrast.earlier,
        later: contrast.later,
        ratio: contrast.ratio,
      },
      observationAttemptIds: contrast.attemptIds,
      boundary: PERFORMANCE_BOUNDARY,
    })
  }
  return out
}

// Strongest authority first, so a debrief that renders the list in order leads with the note that
// rests on the most. A note is derived and never stored, so its id is deterministic rather than
// random: recomputing the same session gives the same id, which lets a caller diff two runs.
export function notesFrom(input: NotesInput): PerformanceNote[] {
  return [
    ...referenceBreaches(input.observations),
    ...baselineDrifts(input.observations, input.baselines),
    ...contrastNotes(input.contrasts),
  ]
}
