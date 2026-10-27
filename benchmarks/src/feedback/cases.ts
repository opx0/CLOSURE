import { readFile } from 'node:fs/promises'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const CaseSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    family: Type.String({ minLength: 1 }),
    split: Type.Union([Type.Literal('tuning'), Type.Literal('heldout')]),
    kind: Type.Union([Type.Literal('topic'), Type.Literal('claim'), Type.Literal('artifact')]),
    question: Type.String({ minLength: 1 }),
    answer: Type.String(),
    originalAnswer: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.Optional(Type.String({ minLength: 1 })),
    sourceState: Type.Optional(Type.Union([Type.Literal('missing'), Type.Literal('deleted')])),
    expected: Type.Object(
      {
        judgment: Type.Union(
          ['supported', 'partial', 'incorrect', 'abstain'].map((value) => Type.Literal(value)),
        ),
        quotes: Type.Array(Type.String({ minLength: 1 })),
        reason: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

const SetSchema = Type.Object(
  {
    version: Type.Literal(1),
    reviewer: Type.Literal('agent-authored; independent review pending'),
    cases: Type.Array(CaseSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
)

export type FeedbackCaseSet = Static<typeof SetSchema>

export function validateFeedbackCases(input: unknown): FeedbackCaseSet {
  if (!Value.Check(SetSchema, input)) throw new Error('invalid feedback fixture schema')
  const ids = new Set<string>()
  const families = new Map<string, string>()
  for (const entry of input.cases) {
    if (ids.has(entry.id)) throw new Error(`duplicate feedback case: ${entry.id}`)
    ids.add(entry.id)
    if (families.has(entry.family) && families.get(entry.family) !== entry.split)
      throw new Error(`feedback family crosses splits: ${entry.family}`)
    families.set(entry.family, entry.split)
    if (entry.kind === 'artifact' && entry.source === undefined && entry.sourceState === undefined)
      throw new Error(`artifact source missing: ${entry.id}`)
    if (
      entry.expected.quotes.length === 0 &&
      (entry.answer !== '' || entry.expected.judgment !== 'abstain')
    )
      throw new Error(`missing reference quote: ${entry.id}`)
    if (entry.expected.quotes.some((quote) => !entry.answer.includes(quote)))
      throw new Error(`reference quote not in final answer: ${entry.id}`)
  }
  return input
}

export async function loadFeedbackCases(
  path: string | URL = new URL('../../../fixtures/feedback/cases.json', import.meta.url),
): Promise<FeedbackCaseSet> {
  return validateFeedbackCases(JSON.parse(await readFile(path, 'utf8')))
}
