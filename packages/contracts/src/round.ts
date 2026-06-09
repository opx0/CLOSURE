import { Type, type Static } from '@sinclair/typebox'

export const RoundKindSchema = Type.Union([
  Type.Literal('project_deep_dive'),
  Type.Literal('design_extension'),
  Type.Literal('behavioral'),
  Type.Literal('code_walkthrough'),
])
export type RoundKind = Static<typeof RoundKindSchema>

export const ROUND_ORDER: readonly RoundKind[] = [
  'project_deep_dive',
  'design_extension',
  'behavioral',
  'code_walkthrough',
]
