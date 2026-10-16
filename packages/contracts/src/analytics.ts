import { Type, type Static } from '@sinclair/typebox'
import { PressureLevelSchema } from './session.ts'
import { PERFORMANCE_BOUNDARY, SignalIdSchema } from './performance.ts'

// Two series types, never one. A combined series would need a shared y-axis, and the only way to put
// a composure finding and a words-per-minute number on one axis is to invent a scale for both.
export const TrendPointSchema = Type.Object({
  at: Type.String({ format: 'date-time' }),
  sessionId: Type.String({ minLength: 1 }),
  value: Type.Number(),
})
export type TrendPoint = Static<typeof TrendPointSchema>

export const PerformanceTrendSchema = Type.Object({
  signal: SignalIdSchema,
  points: Type.Array(TrendPointSchema),
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})
export type PerformanceTrend = Static<typeof PerformanceTrendSchema>

export const LedgerSnapshotSchema = Type.Object({
  at: Type.String({ format: 'date-time' }),
  sessionId: Type.String({ minLength: 1 }),
  gapsOpen: Type.Integer({ minimum: 0 }),
  gapsDrilled: Type.Integer({ minimum: 0 }),
  gapsUnverified: Type.Integer({ minimum: 0 }),
  gapsClosedUnderTransfer: Type.Integer({ minimum: 0 }),
  abstentions: Type.Integer({ minimum: 0 }),
  pressureReached: PressureLevelSchema,
})
export type LedgerSnapshot = Static<typeof LedgerSnapshotSchema>

// Composure held, against the pressure level it held at. The one cross-cut worth drawing, and it
// stays inside the competence lane: both axes come from findings.
export const ComposureByPressureSchema = Type.Object({
  level: PressureLevelSchema,
  held: Type.Integer({ minimum: 0 }),
  folded: Type.Integer({ minimum: 0 }),
})
export type ComposureByPressure = Static<typeof ComposureByPressureSchema>
