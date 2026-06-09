import { Type, type Static } from '@sinclair/typebox'
import { PersonaIdSchema } from './session.ts'
import { RoundKindSchema } from './round.ts'
import { LevelSchema } from './rubric.ts'

export const FormatSourceSchema = Type.Object({
  publisher: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  readOn: Type.String({ minLength: 1 }),
})

export const FormatRoundSchema = Type.Object({
  kind: RoundKindSchema,
  personaId: PersonaIdSchema,
  turns: Type.Integer({ minimum: 1, maximum: 20 }),
  pressureCeiling: Type.Integer({ minimum: 0, maximum: 3 }),
  emphasis: Type.String({ minLength: 1 }),
})

export const InterviewFormatSchema = Type.Object({
  id: Type.String({ minLength: 1, pattern: '^[a-z][a-z0-9_]*$' }),
  label: Type.String({ minLength: 1 }),
  derivedFrom: Type.Array(FormatSourceSchema, { minItems: 1 }),
  disclaimer: Type.String({ minLength: 1 }),
  defaultLevel: LevelSchema,
  rounds: Type.Array(FormatRoundSchema, { minItems: 1 }),
})
export type InterviewFormat = Static<typeof InterviewFormatSchema>
export type FormatRound = Static<typeof FormatRoundSchema>
