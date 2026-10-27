import { Type, type Static } from '@sinclair/typebox'

export const AnswerCorrectionSchema = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  attemptId: Type.String({ minLength: 1 }),
  previousRevision: Type.Integer({ minimum: 1 }),
  revision: Type.Integer({ minimum: 2 }),
  sourceId: Type.String({ minLength: 1 }),
  text: Type.String(),
  reason: Type.String({ minLength: 1, maxLength: 4000 }),
})
export type AnswerCorrection = Static<typeof AnswerCorrectionSchema>

export const FindingReviewSchema = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 128 }),
  findingId: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal('pending'),
    Type.Literal('upheld'),
    Type.Literal('confirmed_error'),
  ]),
  reason: Type.String({ minLength: 1, maxLength: 4000 }),
  sourceRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 10 }),
  reviewer: Type.Literal('candidate_self_review'),
})
export type FindingReview = Static<typeof FindingReviewSchema>
