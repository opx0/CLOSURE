import { Type, type Static } from '@sinclair/typebox'
import { FindingSchema } from './finding.ts'
import { GapEntrySchema } from './gap.ts'
import { PressureLevelSchema } from './session.ts'
import { SpanSchema } from './provenance.ts'
import {
  PerformanceBaselineSchema,
  PerformanceDrillSchema,
  PerformanceNoteSchema,
  PerformanceObservationSchema,
} from './performance.ts'

// The debrief is the one surface that shows both lanes, which makes it the one place they could get
// mixed. They are kept in two objects that share no field, composed here and computed by two core
// modules that are forbidden to import each other (invariant 8).
export const DEBRIEF_WALL = 'two_lanes_never_merged' as const

const EvidenceSummarySchema = Type.Object({
  findingIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  summary: Type.String({ minLength: 1 }),
  quotes: Type.Array(SpanSchema),
})
const PrioritySchema = Type.Object({
  ...EvidenceSummarySchema.properties,
  gapId: Type.String({ minLength: 1 }),
  nextAction: Type.Union([
    Type.Literal('drill'),
    Type.Literal('transfer'),
    Type.Literal('unavailable'),
  ]),
  topicId: Type.Optional(Type.String()),
  claimId: Type.Optional(Type.String()),
  explanation: Type.Optional(Type.String()),
  exercise: Type.Optional(Type.String()),
  retest: Type.Literal('separate_unfamiliar_variant_required'),
})
export const ImprovementPlanSchema = Type.Object({
  leading: Type.Array(PrioritySchema, { maxItems: 3 }),
  remaining: Type.Array(PrioritySchema),
  strengths: Type.Array(EvidenceSummarySchema),
  uncertainty: Type.Array(EvidenceSummarySchema),
})
export type ImprovementPlan = Static<typeof ImprovementPlanSchema>

export const CompetenceLaneSchema = Type.Object({
  plan: Type.Optional(ImprovementPlanSchema),
  findings: Type.Array(FindingSchema),
  gaps: Type.Array(GapEntrySchema),
  abstentions: Type.Integer({ minimum: 0 }),
  pressureReached: PressureLevelSchema,
})
export type CompetenceLane = Static<typeof CompetenceLaneSchema>

export const PerformanceLaneSchema = Type.Object({
  observations: Type.Array(PerformanceObservationSchema),
  notes: Type.Array(PerformanceNoteSchema),
  drills: Type.Array(PerformanceDrillSchema),
  baselines: Type.Array(PerformanceBaselineSchema),
  // True on the first session for a signal, when there is nothing to compare against yet. Saying so
  // is the honest alternative to inventing a band.
  signalsWithoutBaseline: Type.Integer({ minimum: 0 }),
})
export type PerformanceLane = Static<typeof PerformanceLaneSchema>

export const DebriefSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  generatedAt: Type.String({ format: 'date-time' }),
  competence: CompetenceLaneSchema,
  performance: PerformanceLaneSchema,
  wall: Type.Literal(DEBRIEF_WALL),
})
export type Debrief = Static<typeof DebriefSchema>
