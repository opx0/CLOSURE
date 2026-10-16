import { Type, type Static } from '@sinclair/typebox'
import { PERFORMANCE_BOUNDARY } from './performance.ts'

// Discourse markers are counted separately from the filler words in `delivery.ts`. A filler is a
// non-word sound; a marker is a real word doing no work in the sentence. They read differently in a
// transcript and they are fixed by different habits.
export const DISCOURSE_MARKERS: readonly string[] = [
  'like',
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'literally',
  'right',
  'obviously',
  'essentially',
]

export const TimedWordSchema = Type.Object({
  text: Type.String({ minLength: 1 }),
  startMs: Type.Integer({ minimum: 0 }),
  endMs: Type.Integer({ minimum: 0 }),
})
export type TimedWord = Static<typeof TimedWordSchema>

export const PauseKindSchema = Type.Union([Type.Literal('filled'), Type.Literal('unfilled')])

// Mid-clause against clause-boundary is decided lexically, from where the pause falls relative to
// punctuation and conjunctions in the transcript. It is not a judgment about why the pause happened.
export const PausePositionSchema = Type.Union([
  Type.Literal('mid_clause'),
  Type.Literal('clause_boundary'),
])

export const TimedPauseSchema = Type.Object({
  atMs: Type.Integer({ minimum: 0 }),
  durationMs: Type.Integer({ minimum: 0 }),
  kind: PauseKindSchema,
  position: PausePositionSchema,
})
export type TimedPause = Static<typeof TimedPauseSchema>

export const DisfluencyCountsSchema = Type.Object({
  repairs: Type.Integer({ minimum: 0 }),
  restarts: Type.Integer({ minimum: 0 }),
  prolongations: Type.Integer({ minimum: 0 }),
  discourseMarkers: Type.Integer({ minimum: 0 }),
})
export type DisfluencyCounts = Static<typeof DisfluencyCountsSchema>

export const PitchTrackSchema = Type.Object({
  medianHz: Type.Number({ minimum: 0 }),
  p10Hz: Type.Number({ minimum: 0 }),
  p90Hz: Type.Number({ minimum: 0 }),
  rangeSemitones: Type.Number({ minimum: 0 }),
  coefficientOfVariation: Type.Number({ minimum: 0 }),
  // Declaratives that ended on a rising contour, against declaratives counted. Reported as a pair so
  // the denominator is visible; a ratio over two sentences is not the same claim as one over thirty.
  declarativesCounted: Type.Integer({ minimum: 0 }),
  declarativesEndingRising: Type.Integer({ minimum: 0 }),
})
export type PitchTrack = Static<typeof PitchTrackSchema>

export const IntensityTrackSchema = Type.Object({
  medianDb: Type.Number(),
  endOfTurnDropDb: Type.Number(),
})
export type IntensityTrack = Static<typeof IntensityTrackSchema>

// Everything the local sidecar can measure from one spoken answer. Acoustics and timing only: no
// affect, no arousal, no stress, no confidence. Those are not measurable from this signal and
// claiming otherwise is the failure this project exists to refuse.
export const ProsodyReportSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  audioMs: Type.Integer({ minimum: 0 }),
  words: Type.Array(TimedWordSchema),
  pauses: Type.Array(TimedPauseSchema),
  hesitationClusters: Type.Array(
    Type.Object({
      atMs: Type.Integer({ minimum: 0 }),
      durationMs: Type.Integer({ minimum: 0 }),
      events: Type.Integer({ minimum: 2 }),
    }),
  ),
  disfluencies: DisfluencyCountsSchema,
  pitch: PitchTrackSchema,
  intensity: IntensityTrackSchema,
  // Measured from when the question finished rendering to the first word. Absent when the caller
  // could not observe the question's end, which is every non-interactive path.
  responseLatencyMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  timeToFirstContentWordMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  sentenceLengthsWords: Type.Array(Type.Integer({ minimum: 0 })),
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})
export type ProsodyReport = Static<typeof ProsodyReportSchema>
