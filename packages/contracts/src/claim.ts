import { Type, type Static } from '@sinclair/typebox'

// Declaration order is the scale order; ticket 05 §5's ordinal alpha computation depends on it.
export const ClaimVerdictSchema = Type.Union([
  Type.Literal('supported'),
  Type.Literal('partially_supported'),
  Type.Literal('unsupported_by_available_evidence'),
  Type.Literal('contradicted'),
])
export type ClaimVerdict = Static<typeof ClaimVerdictSchema>

export const CLAIM_VERDICT_ORDER: readonly ClaimVerdict[] = [
  'supported',
  'partially_supported',
  'unsupported_by_available_evidence',
  'contradicted',
]

// Off the ordinal scale on purpose, so it can never enter the alpha computation above; scored as coverage instead (ticket 05 §5).
export const ClaimAbstentionSchema = Type.Union([
  Type.Literal('insufficient_evidence'),
  Type.Literal('not_verifiable'),
])
export type ClaimAbstention = Static<typeof ClaimAbstentionSchema>

export const ClaimTypeSchema = Type.Union([
  Type.Literal('built'),
  Type.Literal('designed'),
  Type.Literal('optimized'),
  Type.Literal('led'),
  Type.Literal('measured'),
])
export type ClaimType = Static<typeof ClaimTypeSchema>

export const ClaimSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  spanId: Type.String({ minLength: 1 }),
  type: ClaimTypeSchema,
  assertion: Type.String({ minLength: 1 }),
  technologies: Type.Array(Type.String({ minLength: 1 })),
  metrics: Type.Array(Type.String({ minLength: 1 })),
  implied: Type.Boolean(),
  confirmedByCandidate: Type.Boolean(),
  extractorVersion: Type.String({ minLength: 1 }),
})
export type Claim = Static<typeof ClaimSchema>
