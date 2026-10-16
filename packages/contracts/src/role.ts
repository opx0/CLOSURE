import { Type, type Static } from '@sinclair/typebox'
import { CompetencySchema, LevelSchema } from './rubric.ts'
import { RoundKindSchema } from './round.ts'
import { TopicAreaSchema } from './topic.ts'

export const RoleIdSchema = Type.String({ minLength: 1, pattern: '^[a-z][a-z0-9_]*$' })
export type RoleId = Static<typeof RoleIdSchema>

export const RoleValidationSchema = Type.Union([
  Type.Literal('measured'),
  Type.Literal('unvalidated'),
])
export type RoleValidation = Static<typeof RoleValidationSchema>

export const RolePackSchema = Type.Object({
  id: RoleIdSchema,
  label: Type.String({ minLength: 1 }),
  validation: RoleValidationSchema,
  competencies: Type.Array(CompetencySchema, { minItems: 1 }),
  defaultRounds: Type.Array(RoundKindSchema, { minItems: 1 }),
  defaultLevel: LevelSchema,
  // The role-specific areas its interview draws topics from; the shared CS areas apply to every role.
  areas: Type.Array(TopicAreaSchema, { minItems: 1 }),
  vocabulary: Type.Array(Type.String({ minLength: 1 })),
  expectedConceptsByCompetency: Type.Record(
    Type.String(),
    Type.Array(Type.String({ minLength: 1 })),
  ),
})
export type RolePack = Static<typeof RolePackSchema>
