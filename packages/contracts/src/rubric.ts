import { Type, type Static } from '@sinclair/typebox'

// `id` is a scale identifier — `claim_status`, or a competency id — versioned individually (ticket 11).
export const RubricRefSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.Integer({ minimum: 1 }),
})
export type RubricRef = Static<typeof RubricRefSchema>

export const CLAIM_STATUS_RUBRIC_ID = 'claim_status'

export const CompetencySchema = Type.Union([
  Type.Literal('mechanism'),
  Type.Literal('trade_offs'),
  Type.Literal('failure_modes'),
  Type.Literal('composure'),
])
export type Competency = Static<typeof CompetencySchema>

// Declaration order is the level order (see LEVEL_ORDER below).
export const LevelSchema = Type.Union([
  Type.Literal('junior'),
  Type.Literal('mid'),
  Type.Literal('senior'),
  Type.Literal('staff'),
])
export type Level = Static<typeof LevelSchema>

export const LEVEL_ORDER: readonly Level[] = ['junior', 'mid', 'senior', 'staff']

export const LevelAnchorSchema = Type.Object({
  level: LevelSchema,
  // Read by the Evaluator prompt, never the Conductor — the bar is not disclosed to the thing asking the question.
  expectation: Type.String({ minLength: 1 }),
  requiredConcepts: Type.Array(Type.String({ minLength: 1 })),
})
export type LevelAnchor = Static<typeof LevelAnchorSchema>

export const RubricScaleSchema = Type.Union([
  Type.Literal('claim_status'),
  Type.Literal('competency'),
])
export type RubricScale = Static<typeof RubricScaleSchema>

export const RubricSchema = Type.Object({
  ref: RubricRefSchema,
  scale: RubricScaleSchema,
  anchors: Type.Array(LevelAnchorSchema, { minItems: 1 }),
})
export type Rubric = Static<typeof RubricSchema>

// The set is the list of pinned pairs, not an object with its own version (ticket 11).
export const RubricSetSchema = Type.Array(RubricRefSchema, { minItems: 1 })
export type RubricSet = Static<typeof RubricSetSchema>
