import { Type, type Static } from '@sinclair/typebox'

export const RoundKindSchema = Type.Union([
  Type.Literal('project_deep_dive'),
  Type.Literal('design_extension'),
  Type.Literal('behavioral'),
  Type.Literal('code_walkthrough'),
  Type.Literal('cs_fundamentals'),
  Type.Literal('problem_solving'),
  Type.Literal('role_knowledge'),
  Type.Literal('system_design'),
])
export type RoundKind = Static<typeof RoundKindSchema>

export const ROUND_ORDER: readonly RoundKind[] = [
  'cs_fundamentals',
  'problem_solving',
  'role_knowledge',
  'system_design',
  'behavioral',
  'project_deep_dive',
  'design_extension',
  'code_walkthrough',
]
