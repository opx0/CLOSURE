import { Type, type Static } from '@sinclair/typebox'
import { LevelSchema } from './rubric.ts'

export const TopicAreaSchema = Type.Union([
  Type.Literal('os'),
  Type.Literal('dbms'),
  Type.Literal('networks'),
  Type.Literal('oop'),
  Type.Literal('dsa'),
  Type.Literal('system_design'),
  Type.Literal('web'),
  Type.Literal('backend'),
  Type.Literal('ml'),
  Type.Literal('data'),
  Type.Literal('devops'),
  Type.Literal('behavioral'),
])
export type TopicArea = Static<typeof TopicAreaSchema>

const concepts = Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })

// Authored content, not candidate data: a topic is what the interviewer chose to ask about, so it is
// trusted in a prompt the way a claim or a repository never is.
export const TopicSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$' }),
  area: TopicAreaSchema,
  title: Type.String({ minLength: 1 }),
  ask: Type.String({ minLength: 1 }),
  minLevel: LevelSchema,
  expected: Type.Object({
    mechanism: concepts,
    trade_offs: concepts,
    failure_modes: concepts,
  }),
  // Wrong on purpose and fixed in data, so a false-premise turn cannot drift into a true statement.
  falsePremise: Type.String({ minLength: 1 }),
  twist: Type.String({ minLength: 1 }),
})
export type Topic = Static<typeof TopicSchema>
