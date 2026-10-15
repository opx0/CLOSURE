import {
  SIGNALS,
  type NoteTrigger,
  type PerformanceBaseline,
  type PerformanceDrill,
  type PerformanceLane,
  type PerformanceNote,
  type PerformanceObservation,
  type PerformanceUnit,
  type WithinSessionContrast,
} from '@levelhead/contracts'

// The debrief's other half. This file may name observations, notes, baselines and drills, and may
// not name a single type from the judged lane. Nothing here reads an answer; it reads numbers about
// how one was delivered.

export interface PerformanceLaneInput {
  readonly observations: readonly PerformanceObservation[]
  readonly notes: readonly PerformanceNote[]
  readonly drills: readonly PerformanceDrill[]
  readonly baselines: readonly PerformanceBaseline[]
}

// A note's non-empty tuple of attempt ids is a compile-time strengthening of the schema's
// `minItems: 1`, so widening back to the schema's own type loses nothing. Same move, and the same
// reason, as `widenFindings` in the contracts package.
function widenNotes(notes: readonly PerformanceNote[]): PerformanceLane['notes'] {
  return notes as unknown as PerformanceLane['notes']
}

export function performanceLane(input: PerformanceLaneInput): PerformanceLane {
  const known = new Set(input.baselines.map((baseline) => baseline.signal))
  const measured = new Set(input.observations.map((observation) => observation.signal))

  return {
    observations: [...input.observations],
    notes: widenNotes(input.notes),
    drills: [...input.drills],
    baselines: [...input.baselines],
    // On a first session this is the whole answer to "how am I doing". Naming the number is honest;
    // inventing a band for any of those signals would not be.
    signalsWithoutBaseline: [...measured].filter((signal) => !known.has(signal)).length,
  }
}

// Decimals and suffix per unit, in one table, so a rendered number carries the same precision
// wherever it appears and no call site picks its own.
const UNIT_FORMAT: Record<PerformanceUnit, { decimals: number; suffix: string }> = {
  words_per_minute: { decimals: 0, suffix: ' wpm' },
  milliseconds: { decimals: 0, suffix: ' ms' },
  ratio: { decimals: 2, suffix: '' },
  per_minute: { decimals: 1, suffix: ' per minute' },
  per_hundred_words: { decimals: 1, suffix: ' per 100 words' },
  semitones: { decimals: 1, suffix: ' semitones' },
  decibels: { decimals: 1, suffix: ' dB' },
  degrees_squared: { decimals: 1, suffix: ' deg²' },
}

function bare(value: number, unit: PerformanceUnit): string {
  return value.toFixed(UNIT_FORMAT[unit].decimals)
}

function withUnit(value: number, unit: PerformanceUnit): string {
  return `${bare(value, unit)}${UNIT_FORMAT[unit].suffix}`
}

type LaneNote = PerformanceLane['notes'][number]

const CONTRAST_LABEL: Record<WithinSessionContrast, string> = {
  early_vs_late_in_answer: 'early against late in the same answer',
  low_vs_high_pressure: 'at low pressure against at high pressure',
  before_vs_after_interruption: 'before against after an interruption',
}

// A note is never allowed to render as a bare adjective. Whatever raised it, the reader sees the
// numbers and the thing they were compared against on the same line.
function comparison(trigger: NoteTrigger, unit: PerformanceUnit): string {
  switch (trigger.kind) {
    case 'baseline_drift': {
      const { baseline } = trigger
      const spread = `${bare(baseline.p25, unit)}–${bare(baseline.p75, unit)}`
      return `${withUnit(trigger.observed, unit)} this session, ${trigger.direction} your own baseline of ${withUnit(baseline.median, unit)} (n=${baseline.n}, middle half ${spread})`
    }
    case 'within_session_contrast':
      return `${withUnit(trigger.earlier, unit)} then ${withUnit(trigger.later, unit)}, ×${trigger.ratio.toFixed(2)}, ${CONTRAST_LABEL[trigger.contrast]}, both from this session`
    case 'reference_breach':
      return `${withUnit(trigger.observed, unit)} this session, outside the ${bare(trigger.low, unit)}–${bare(trigger.high, unit)} band cited from ${trigger.source}`
  }
}

export const PERFORMANCE_HEADING = 'HOW YOU CAME ACROSS · measured from the recording, never judged'

function drillLine(drill: PerformanceDrill): string {
  return `    Drill · ${drill.instruction} (retested by ${SIGNALS[drill.retestSignal].label})`
}

function noteLines(note: LaneNote, drills: readonly PerformanceDrill[]): string[] {
  const spec = SIGNALS[note.signal]
  return [
    `  ${spec.label} · ${note.summary}`,
    `    ${comparison(note.trigger, spec.unit)}`,
    `    Raised by ${note.observationAttemptIds.join(', ')}`,
    ...drills.filter((drill) => drill.noteId === note.id).map(drillLine),
    '',
  ]
}

export function renderPerformanceLane(lane: PerformanceLane): string[] {
  const out = [PERFORMANCE_HEADING, '-'.repeat(PERFORMANCE_HEADING.length)]

  if (lane.notes.length === 0) {
    out.push('  No signal moved away from your own baseline or between conditions.', '')
  }
  for (const note of lane.notes) out.push(...noteLines(note, lane.drills))

  const noted = new Set(lane.notes.map((note) => note.id))
  const orphans = lane.drills.filter((drill) => !noted.has(drill.noteId))
  // Says only what is true of them. Calling them carried over would invent a provenance nothing here
  // knows, and dropping them would hide an input the caller got wrong.
  if (orphans.length > 0) {
    out.push('  Drills with no note in this debrief', ...orphans.map(drillLine), '')
  }

  // Three counts that add up, so the reader can see that every signal measured either had something
  // to be compared against or is being measured for the first time. `baselines` is the candidate's
  // whole history and would answer a different question.
  const measuredHere = new Set(lane.observations.map((one) => one.signal)).size
  out.push(
    `  Signals measured this session   ${measuredHere}`,
    `  Compared against your baseline  ${measuredHere - lane.signalsWithoutBaseline}`,
    `  Measured for the first time     ${lane.signalsWithoutBaseline}`,
  )
  if (lane.signalsWithoutBaseline > 0) {
    out.push(
      '  This session establishes your baseline for them. There is nothing yet to compare them against.',
    )
  }

  // The same closing the delivery report has carried since it was three numbers, kept here rather
  // than in the composed debrief so it travels with the numbers even when this lane renders alone.
  out.push(
    '',
    '  These are observations about how the answers were delivered. They say nothing about whether',
    '  any answer was any good, they are never part of a finding, and they never reach the gap',
    '  ledger.',
  )
  return out
}
