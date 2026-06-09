import { Type, type Static } from '@sinclair/typebox'

export const FILLER_WORDS: readonly string[] = [
  'um',
  'uh',
  'erm',
  'like',
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'literally',
  'right',
]

export const SpokenTurnSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  transcript: Type.String(),
  audioMs: Type.Integer({ minimum: 0 }),
  pauses: Type.Array(
    Type.Object({
      atMs: Type.Integer({ minimum: 0 }),
      durationMs: Type.Integer({ minimum: 0 }),
    }),
  ),
})
export type SpokenTurn = Static<typeof SpokenTurnSchema>

export const DeliveryReportSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  wordsPerMinute: Type.Number({ minimum: 0 }),
  spokenSeconds: Type.Number({ minimum: 0 }),
  wordCount: Type.Integer({ minimum: 0 }),
  longPauseCount: Type.Integer({ minimum: 0 }),
  longestPauseMs: Type.Integer({ minimum: 0 }),
  fillerCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  fillerRatePerHundredWords: Type.Number({ minimum: 0 }),
  boundary: Type.Literal('delivery_only_never_competence'),
})
export type DeliveryReport = Static<typeof DeliveryReportSchema>

export const DELIVERY_BOUNDARY = 'delivery_only_never_competence' as const
