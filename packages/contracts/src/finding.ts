import { Type, type Static } from '@sinclair/typebox'
import { ClaimAbstentionSchema, ClaimVerdictSchema } from './claim.ts'
import { CompetencySchema, LevelSchema, RubricRefSchema } from './rubric.ts'

const findingBase = {
  id: Type.String({ minLength: 1 }),
  attemptId: Type.String({ minLength: 1 }),
  rubric: RubricRefSchema,
  // Which level's anchor this was judged against — "partially supported" means different things at junior and staff.
  level: LevelSchema,
  rationale: Type.String({ minLength: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  modelVersion: Type.String({ minLength: 1 }),
  promptVersion: Type.String({ minLength: 1 }),
  transcriptSpanIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  evidenceIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}

export const ClaimFindingSchema = Type.Object({
  ...findingBase,
  kind: Type.Literal('claim'),
  claimId: Type.String({ minLength: 1 }),
  verdict: ClaimVerdictSchema,
})

// Abstention is a value, never a null verdict and never an error. It still cites what it read.
export const ClaimAbstentionFindingSchema = Type.Object({
  ...findingBase,
  kind: Type.Literal('claim_abstained'),
  claimId: Type.String({ minLength: 1 }),
  abstention: ClaimAbstentionSchema,
})

// Categorical with valence, not a ladder — holding ground and honest yielding are both good but condition on opposite truth states, so they can't be ranked against each other.
export const ComposureSignalSchema = Type.Union([
  Type.Literal('folding'),
  Type.Literal('fabricating'),
  Type.Literal('holding_ground'),
  Type.Literal('honest_yielding'),
  Type.Literal('coherence_after_interruption'),
  Type.Literal('escalation'),
])
export type ComposureSignal = Static<typeof ComposureSignalSchema>

// Signals that mean composure held; the dosing ladder steps up after two in a row — code reads this, the model never decides the level.
export const COMPOSURE_HELD: readonly ComposureSignal[] = [
  'holding_ground',
  'honest_yielding',
  'coherence_after_interruption',
]

export const ComposureFindingSchema = Type.Object({
  ...findingBase,
  kind: Type.Literal('composure'),
  competency: CompetencySchema,
  signals: Type.Array(ComposureSignalSchema, { minItems: 1 }),
})

// A judgment about a competency that is not composure — mechanism, trade-offs, failure modes.
export const CompetencyFindingSchema = Type.Object({
  ...findingBase,
  kind: Type.Literal('competency'),
  competency: CompetencySchema,
  // The level actually met, not necessarily the level judged against; null when it met none.
  levelMet: Type.Union([LevelSchema, Type.Null()]),
})

// A topic turn has no claim to abstain on, and the right to say "I cannot tell" cannot depend on there being one.
export const CompetencyAbstentionFindingSchema = Type.Object({
  ...findingBase,
  kind: Type.Literal('competency_abstained'),
  competency: CompetencySchema,
  abstention: ClaimAbstentionSchema,
})

export const FindingSchema = Type.Union([
  ClaimFindingSchema,
  ClaimAbstentionFindingSchema,
  ComposureFindingSchema,
  CompetencyFindingSchema,
  CompetencyAbstentionFindingSchema,
])

type NonEmpty<T> = readonly [T, ...T[]]

// The conditional makes this distribute over the union — a bare `Omit` collapses to the keys common to every member and would silently erase `verdict`, `abstention` and `signals`.
type WithCitations<T> = T extends unknown
  ? Omit<T, 'transcriptSpanIds' | 'evidenceIds'> & {
      readonly transcriptSpanIds: NonEmpty<string>
      readonly evidenceIds: NonEmpty<string>
    }
  : never

export type Finding = WithCitations<Static<typeof FindingSchema>>
export type ClaimFinding = WithCitations<Static<typeof ClaimFindingSchema>>
export type ClaimAbstentionFinding = WithCitations<Static<typeof ClaimAbstentionFindingSchema>>
export type ComposureFinding = WithCitations<Static<typeof ComposureFindingSchema>>
export type CompetencyFinding = WithCitations<Static<typeof CompetencyFindingSchema>>
export type CompetencyAbstentionFinding = WithCitations<
  Static<typeof CompetencyAbstentionFindingSchema>
>

// The non-empty tuples above are a compile-time strengthening of the schema's `minItems: 1`, so
// widening back to the schema type loses nothing. One helper, so no caller re-invents the cast.
export function widenFindings(findings: readonly Finding[]): Static<typeof FindingSchema>[] {
  return findings as unknown as Static<typeof FindingSchema>[]
}
