import { test, expect } from 'bun:test'
import { SIGNAL_IDS } from '@levelhead/contracts'
import type { PerformanceNote } from '@levelhead/contracts'
import { DRILL_INSTRUCTIONS, drillsFor } from './drills.ts'

function noteOf(id: string, signal: PerformanceNote['signal']): PerformanceNote {
  return {
    id,
    signal,
    family: 'speech',
    summary: 'a summary the drill does not read',
    trigger: {
      kind: 'within_session_contrast',
      contrast: 'early_vs_late_in_answer',
      earlier: 100,
      later: 150,
      ratio: 1.5,
    },
    observationAttemptIds: ['attempt-1'],
    boundary: 'observation_only_never_competence',
  }
}

test('each note gets one drill, in the order the notes arrived', () => {
  const drills = drillsFor([
    noteOf('note-a', 'filled_pause_rate'),
    noteOf('note-b', 'framing_headroom'),
  ])

  expect(drills).toEqual([
    {
      noteId: 'note-a',
      signal: 'filled_pause_rate',
      instruction:
        'When a filler is about to arrive, close your mouth and wait. Silence is the substitute you are practising.',
      retestSignal: 'filled_pause_rate',
      boundary: 'observation_only_never_competence',
    },
    {
      noteId: 'note-b',
      signal: 'framing_headroom',
      instruction:
        'Raise or lower the camera until your eyes sit on the top third line of the frame.',
      retestSignal: 'framing_headroom',
      boundary: 'observation_only_never_competence',
    },
  ])
})

test('no notes means no drills', () => {
  expect(drillsFor([])).toEqual([])
})

test('the drill is retested by the signal that raised it', () => {
  const drills = drillsFor(SIGNAL_IDS.map((signal, index) => noteOf(`note-${index}`, signal)))

  expect(drills.length).toBe(SIGNAL_IDS.length)
  expect(drills.filter((drill) => drill.retestSignal !== drill.signal)).toEqual([])
})

// A signal added to the registry without an instruction would produce a note nobody can act on.
// The table is a complete record, so that fails to compile, and this catches a placeholder that
// satisfied the compiler by repeating a neighbour.
test('every signal in the registry has its own instruction', () => {
  const instructions = SIGNAL_IDS.map((signal) => DRILL_INSTRUCTIONS[signal])

  expect(instructions.filter((instruction) => instruction.trim() === '')).toEqual([])
  expect(new Set(instructions).size).toBe(SIGNAL_IDS.length)
})

test('an instruction is something the candidate can do in the next session', () => {
  expect(DRILL_INSTRUCTIONS.interruption_recovery_time).toBe(
    'When you are cut off, take one breath, restate the new question in your own words, then answer it.',
  )
  expect(DRILL_INSTRUCTIONS.exposure_clipped_ratio).toBe(
    'Move or switch off the brightest light in the shot until nothing in the frame is pure white.',
  )
  expect(DRILL_INSTRUCTIONS.rate_drift_within_answer).toBe(
    'Plan the last sentence before you start, and say it at the tempo you opened with.',
  )
})
