import { Type, type Static } from '@sinclair/typebox'
import { RoundKindSchema } from './round.ts'
import { RoleIdSchema } from './role.ts'
import { LevelSchema, RubricSetSchema } from './rubric.ts'
import { StorySchema } from './story.ts'

export const PreparationSelectionSchema = Type.Object(
  {
    claimIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100, uniqueItems: true }),
    snapshotId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
export type PreparationSelection = Static<typeof PreparationSelectionSchema>

export const PreparationGoalsSchema = Type.Object(
  {
    roleId: RoleIdSchema,
    level: LevelSchema,
    goals: Type.String({ maxLength: 5000 }),
    availableMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10080 })),
    jobDescription: Type.Optional(Type.String({ maxLength: 20000 })),
  },
  { additionalProperties: false },
)
export type PreparationGoals = Static<typeof PreparationGoalsSchema>

export const ModeSchema = Type.Union([
  Type.Literal('simulation'),
  Type.Literal('coach'),
  Type.Literal('drill'),
  Type.Literal('transfer'),
  Type.Literal('review'),
])
export type Mode = Static<typeof ModeSchema>

// A persona configures the policy — which actions it favours, how it doses pressure — not a prompt vibe, so a session stays inspectable.
export const PersonaIdSchema = Type.Union([
  Type.Literal('collaborator'),
  Type.Literal('skeptic'),
  Type.Literal('bar_raiser'),
  Type.Literal('rusher'),
])
export type PersonaId = Static<typeof PersonaIdSchema>

export const PressureLevelSchema = Type.Integer({ minimum: 0, maximum: 3 })

// The loop's explicit state machine (ticket 19): a typed machine, never `while: ask model; wait`.
export const SessionStateSchema = Type.Union([
  Type.Literal('selecting'),
  Type.Literal('asking'),
  Type.Literal('awaiting_answer'),
  Type.Literal('observing'),
  Type.Literal('evaluating'),
  Type.Literal('drilling'),
  Type.Literal('closed'),
])
export type SessionState = Static<typeof SessionStateSchema>

export const SessionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  mode: ModeSchema,
  level: LevelSchema,
  personaId: PersonaIdSchema,
  pressureLevel: PressureLevelSchema,
  // The candidate's own cap, and Coach mode's cap, both land here. §4.3: dosed, not maximal.
  pressureCeiling: PressureLevelSchema,
  // Pinned at session start; changing a rubric mid-session would invalidate the session's labels.
  rubricSet: RubricSetSchema,
  claimIds: Type.Array(Type.String({ minLength: 1 })),
  roleId: Type.Optional(RoleIdSchema),
  // Chosen by code at session start and recorded here, so replay never re-runs topic selection.
  topicIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  // One element is the ordinary case, not a special one — Simulation can chain rounds like a real loop.
  rounds: Type.Array(RoundKindSchema, { minItems: 1 }),
  snapshotId: Type.Optional(Type.String({ minLength: 1 })),
  practiceGapId: Type.Optional(Type.String({ minLength: 1 })),
  practiceVariantId: Type.Optional(Type.String({ minLength: 1 })),
  practiceVariantVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  story: Type.Optional(StorySchema),
  startedAt: Type.String({ format: 'date-time' }),
})
export type Session = Static<typeof SessionSchema>

// One pass at a single question. A session has many attempts (CONTEXT.md).
export const AttemptSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  claimId: Type.Optional(Type.String({ minLength: 1 })),
  topicId: Type.Optional(Type.String({ minLength: 1 })),
  questionEventId: Type.String({ minLength: 1 }),
})
export type Attempt = Static<typeof AttemptSchema>
