import { Type, type Static } from '@sinclair/typebox'
import { CompetencySchema } from './rubric.ts'

// `closed_under_transfer` is the only closing status — passing the drill closes nothing (§4.5).
export const GapStatusSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('drilled'),
  Type.Literal('unverified'),
  Type.Literal('closed_under_transfer'),
])
export type GapStatus = Static<typeof GapStatusSchema>

export const PracticeReceiptSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  kind: Type.Union([Type.Literal('drill'), Type.Literal('transfer'), Type.Literal('retrieval')]),
  held: Type.Boolean(),
})
export type PracticeReceipt = Static<typeof PracticeReceiptSchema>

export const PracticeOutcomeSchema = Type.Object({
  gapId: Type.String({ minLength: 1 }),
  ...PracticeReceiptSchema.properties,
})
export type PracticeOutcome = Static<typeof PracticeOutcomeSchema>

export const GapEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  competency: CompetencySchema,
  claimId: Type.Optional(Type.String({ minLength: 1 })),
  topicId: Type.Optional(Type.String({ minLength: 1 })),
  snapshotId: Type.Optional(Type.String({ minLength: 1 })),
  artifactId: Type.Optional(Type.String({ minLength: 1 })),
  summary: Type.String({ minLength: 1 }),
  status: GapStatusSchema,
  // Carries the finding's citations forward — the ledger row must show the candidate's own words (§4.6's Evidence column).
  findingIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  evidenceIds: Type.Array(Type.String({ minLength: 1 })),
  openedAt: Type.String({ format: 'date-time' }),
  lastTouchedAt: Type.String({ format: 'date-time' }),
  // Both failed and successful Transfer attempts. Only a held outcome licenses closure.
  transferAttemptIds: Type.Array(Type.String({ minLength: 1 })),
  practiceReceipts: Type.Optional(Type.Array(PracticeReceiptSchema)),
  // Optional so it stays valid on gap_opened events already written; `passed` matters so a re-drilled lapse doesn't read as a second survived retrieval.
  retrievals: Type.Optional(
    Type.Array(
      Type.Object({
        attemptId: Type.String({ minLength: 1 }),
        at: Type.String({ format: 'date-time' }),
        passed: Type.Boolean(),
      }),
    ),
  ),
})
export type GapEntry = Static<typeof GapEntrySchema>
