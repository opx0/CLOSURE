import { Type, type Static } from '@sinclair/typebox'
import { FindingSchema } from './finding.ts'
import { GapEntrySchema } from './gap.ts'
import { PressureLevelSchema } from './session.ts'
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

export const CompetenceLaneSchema = Type.Object({
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
