import { expect, test } from 'bun:test'
import { loadFeedbackCases, validateFeedbackCases } from './cases.ts'

test('reference cases preserve final-answer evidence and hold families out of tuning', async () => {
  const fixtures = await loadFeedbackCases()
  expect(fixtures.cases).toHaveLength(16)
  expect(new Set(fixtures.cases.map((entry) => entry.kind)).size).toBe(3)
  const changed = structuredClone(fixtures)
  changed.cases[0]!.expected.quotes = ['words never said']
  expect(() => validateFeedbackCases(changed)).toThrow('not in final answer')
  changed.cases[0] = fixtures.cases[0]!
  changed.cases.push({ ...fixtures.cases[0]!, id: 'another-id', split: 'heldout' })
  expect(() => validateFeedbackCases(changed)).toThrow('crosses splits')
  expect(() => validateFeedbackCases({ ...fixtures, reviewer: 'human-reviewed' })).toThrow('schema')
})
