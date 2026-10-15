import { Type, type Static } from '@sinclair/typebox'

export const ResumeTagKindSchema = Type.Union([
  Type.Literal('implied_unconfirmed'),
  Type.Literal('no_metric'),
  Type.Literal('linked_code'),
  Type.Literal('no_code_evidence'),
  Type.Literal('code_not_checked'),
  Type.Literal('held'),
  Type.Literal('partially_supported'),
  Type.Literal('contradicted'),
  Type.Literal('open_gap'),
])
export type ResumeTagKind = Static<typeof ResumeTagKindSchema>

// Every tag carries what earned it; a tag with nothing behind it is an opinion about the résumé.
export const ResumeTagSchema = Type.Object({
  kind: ResumeTagKindSchema,
  claimId: Type.String({ minLength: 1 }),
  advice: Type.String({ minLength: 1 }),
  quotes: Type.Array(Type.String({ minLength: 1 })),
  findingIds: Type.Array(Type.String({ minLength: 1 })),
  gapIds: Type.Array(Type.String({ minLength: 1 })),
  artifactPaths: Type.Array(Type.String({ minLength: 1 })),
})
export type ResumeTag = Static<typeof ResumeTagSchema>

export const ResumeLineSchema = Type.Object({
  spanId: Type.String({ minLength: 1 }),
  text: Type.String(),
  claimIds: Type.Array(Type.String({ minLength: 1 })),
  tags: Type.Array(ResumeTagSchema),
})
export type ResumeLine = Static<typeof ResumeLineSchema>

export const ResumeFeedbackSchema = Type.Object({
  lines: Type.Array(ResumeLineSchema),
  snapshotIds: Type.Array(Type.String({ minLength: 1 })),
})
export type ResumeFeedback = Static<typeof ResumeFeedbackSchema>
