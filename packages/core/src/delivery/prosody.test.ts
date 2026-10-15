import { expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { PERFORMANCE_BOUNDARY, ProsodyReportSchema } from '@levelhead/contracts'
import { buildProsodyReport, renderProsody } from './prosody.ts'
import type { ProsodyInput } from './prosody.ts'

const answer: ProsodyInput = {
  attemptId: 'att_1',
  questionEndedAtMs: 600,
  measurement: {
    audioMs: 10_000,
    words: [
      { text: 'Um,', startMs: 1_000, endMs: 1_300 },
      { text: 'basically', startMs: 1_300, endMs: 1_800 },
      { text: 'we', startMs: 1_800, endMs: 1_950 },
      { text: 'we', startMs: 1_950, endMs: 2_100 },
      { text: 'leased', startMs: 2_100, endMs: 2_500 },
      { text: 'each', startMs: 2_500, endMs: 2_700 },
      { text: 'job,', startMs: 2_700, endMs: 3_000 },
      { text: 'um', startMs: 3_600, endMs: 4_000 },
      { text: 'sooo', startMs: 4_500, endMs: 5_800 },
      { text: 'about', startMs: 6_200, endMs: 6_400 },
      { text: 'thirty', startMs: 6_400, endMs: 6_700 },
      { text: 'seconds.', startMs: 6_700, endMs: 7_300 },
      { text: 'The', startMs: 7_800, endMs: 8_000 },
      { text: 'lease', startMs: 8_000, endMs: 8_300 },
      { text: 'the', startMs: 8_300, endMs: 8_500 },
      { text: 'lease', startMs: 8_500, endMs: 8_800 },
      { text: 'holder', startMs: 8_800, endMs: 9_300 },
      { text: 'renews', startMs: 9_300, endMs: 9_700 },
      { text: 'it.', startMs: 9_700, endMs: 10_000 },
    ],
    sentences: [
      { words: 12, endsRising: false },
      { words: 7, endsRising: true },
    ],
    pitch: {
      medianHz: 138,
      p10Hz: 118,
      p90Hz: 165,
      rangeSemitones: 5.8,
      coefficientOfVariation: 0.14,
    },
    intensity: { medianDb: 61.2, endOfTurnDropDb: -4.6 },
  },
}

const question: ProsodyInput = {
  attemptId: 'att_2',
  measurement: {
    audioMs: 800,
    words: [
      { text: 'Sharded', startMs: 0, endMs: 400 },
      { text: 'how?', startMs: 400, endMs: 800 },
    ],
    sentences: [{ words: 2, endsRising: true }],
    pitch: {
      medianHz: 142,
      p10Hz: 120,
      p90Hz: 180,
      rangeSemitones: 7,
      coefficientOfVariation: 0.2,
    },
    intensity: { medianDb: 60, endOfTurnDropDb: -1.5 },
  },
}

const silence: ProsodyInput = {
  attemptId: 'att_3',
  measurement: {
    audioMs: 0,
    words: [],
    sentences: [],
    pitch: {
      medianHz: Number.NaN,
      p10Hz: Number.NaN,
      p90Hz: Number.NaN,
      rangeSemitones: Number.NaN,
      coefficientOfVariation: Number.NaN,
    },
    intensity: { medianDb: Number.NaN, endOfTurnDropDb: Number.NaN },
  },
}

const oneWord: ProsodyInput = {
  attemptId: 'att_4',
  measurement: {
    audioMs: 900,
    words: [{ text: 'Yes.', startMs: 500, endMs: 900 }],
    sentences: [{ words: 1, endsRising: false }],
    pitch: {
      medianHz: 130,
      p10Hz: 122,
      p90Hz: 140,
      rangeSemitones: 2.4,
      coefficientOfVariation: 0.08,
    },
    intensity: { medianDb: 58.4, endOfTurnDropDb: -0.9 },
  },
}

test('a filler inside a gap makes it a filled pause, not two silent ones', () => {
  const report = buildProsodyReport(answer)

  expect(report.pauses.length).toBe(3)
  expect(report.pauses[0]).toEqual({
    atMs: 3_000,
    durationMs: 1_500,
    kind: 'filled',
    position: 'clause_boundary',
  })
})

test('a pause is at a clause boundary only when the word before it closed a clause', () => {
  const report = buildProsodyReport(answer)

  expect(report.pauses[1]).toEqual({
    atMs: 5_800,
    durationMs: 400,
    kind: 'unfilled',
    position: 'mid_clause',
  })
  expect(report.pauses[2]).toEqual({
    atMs: 7_300,
    durationMs: 500,
    kind: 'unfilled',
    position: 'clause_boundary',
  })
})

test('a repeated word, a stretched word and an abandoned clause are counted apart', () => {
  const report = buildProsodyReport(answer)

  expect(report.disfluencies).toEqual({
    repairs: 1,
    restarts: 1,
    prolongations: 1,
    discourseMarkers: 1,
  })
})

test('hesitations inside one window are reported as a single cluster', () => {
  const report = buildProsodyReport(answer)

  expect(report.hesitationClusters).toEqual([{ atMs: 1_950, durationMs: 2_550, events: 3 }])
})

test('onset is timed to the first word and again to the first word that carries content', () => {
  const report = buildProsodyReport(answer)

  expect(report.responseLatencyMs).toBe(400)
  expect(report.timeToFirstContentWordMs).toBe(1_800)
})

test('sentence lengths are carried through as measured', () => {
  const report = buildProsodyReport(answer)

  expect(report.sentenceLengthsWords).toEqual([12, 7])
})

test('a statement that ended on a rise is counted against the statements counted', () => {
  const report = buildProsodyReport(answer)

  expect(report.pitch.declarativesCounted).toBe(2)
  expect(report.pitch.declarativesEndingRising).toBe(1)
})

test('pitch and loudness are reported as the sidecar measured them', () => {
  const report = buildProsodyReport(answer)

  expect(report.pitch.medianHz).toBe(138)
  expect(report.intensity.endOfTurnDropDb).toBe(-4.6)
})

test('a question is not a statement, so its rise is never counted', () => {
  const report = buildProsodyReport(question)

  expect(report.pitch.declarativesCounted).toBe(0)
  expect(report.pitch.declarativesEndingRising).toBe(0)
})

test('silence produces empty lists and zeros rather than invented numbers', () => {
  const report = buildProsodyReport(silence)

  expect(report.pauses).toEqual([])
  expect(report.hesitationClusters).toEqual([])
  expect(report.disfluencies).toEqual({
    repairs: 0,
    restarts: 0,
    prolongations: 0,
    discourseMarkers: 0,
  })
  expect(report.timeToFirstContentWordMs).toBeNull()
  expect(report.responseLatencyMs).toBeNull()
  expect(report.sentenceLengthsWords).toEqual([])
  expect(report.pitch.medianHz).toBe(0)
  expect(report.intensity.medianDb).toBe(0)
  expect(Number.isNaN(report.pitch.medianHz)).toBe(false)
})

test('one word cannot be three times its own median, so nothing is a disfluency', () => {
  const report = buildProsodyReport(oneWord)

  expect(report.pauses).toEqual([])
  expect(report.disfluencies).toEqual({
    repairs: 0,
    restarts: 0,
    prolongations: 0,
    discourseMarkers: 0,
  })
  expect(report.timeToFirstContentWordMs).toBe(500)
  expect(report.sentenceLengthsWords).toEqual([1])
  expect(report.pitch.declarativesCounted).toBe(1)
})

test('every report carries the boundary that it is never competence', () => {
  const report = buildProsodyReport(answer)
  const rendered = renderProsody(report).join('\n')

  expect(report.boundary).toBe(PERFORMANCE_BOUNDARY)
  expect(rendered).toContain('never part of a finding')
  expect(rendered).not.toContain('verdict')
  expect(rendered).not.toContain('confidence')
})

test('the report satisfies the contract that carries it across a process boundary', () => {
  const report = buildProsodyReport(answer)

  expect(Value.Check(ProsodyReportSchema, report)).toBe(true)
  expect(Value.Check(ProsodyReportSchema, { ...report, pauses: [{ atMs: -1 }] })).toBe(false)
})
