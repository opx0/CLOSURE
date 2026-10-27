import { Type, type Static } from '@sinclair/typebox'

export const StorySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    situation: Type.String({ minLength: 1, maxLength: 4000 }),
    action: Type.String({ minLength: 1, maxLength: 4000 }),
    result: Type.String({ minLength: 1, maxLength: 4000 }),
    confirmed: Type.Literal(true),
  },
  { additionalProperties: false },
)
export type Story = Static<typeof StorySchema>
