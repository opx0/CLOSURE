import { Type, type Static } from '@sinclair/typebox'

// Candidate-authored source, kept verbatim by revision. Mermaid is stored as text and never
// interpreted by the API or sent to a diagram renderer with executable directives.
export const DesignSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    requirements: Type.String({ minLength: 1, maxLength: 6000 }),
    estimates: Type.String({ maxLength: 4000 }),
    api: Type.String({ maxLength: 6000 }),
    dataModel: Type.String({ maxLength: 6000 }),
    diagram: Type.String({ maxLength: 6000 }),
    constraint: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
)
export type Design = Static<typeof DesignSchema>
