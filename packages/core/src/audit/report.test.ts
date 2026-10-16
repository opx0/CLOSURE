import { expect, test } from 'bun:test'
import { AUDIT_BOUNDARY, type AuditDelta } from './blind.ts'
import {
  blindAuditReport,
  limitationFor,
  renderBlindAudit,
  type BlindComparison,
} from './report.ts'

function delta(overrides: Partial<AuditDelta> = {}): AuditDelta {
  return {
    compared: 1,
    verdictChanges: 0,
    abstentionChanges: 0,
    largestConfidenceShift: 0,
    perFinding: [],
    boundary: AUDIT_BOUNDARY,
    ...overrides,
  }
}

// Two answers, three rewrites between them. n is two, because one answer rewritten twice is still
// one answer, and reporting three would overstate the audit by half.
const COMPARISONS: BlindComparison[] = [
  {
    attemptId: 'att_1',
    variantId: 'blind:personal_names_masked',
    transforms: ['personal_names_masked'],
    delta: delta({ verdictChanges: 1, largestConfidenceShift: 0.25 }),
  },
  {
    attemptId: 'att_1',
    variantId: 'blind:gendered_pronouns_neutralised',
    transforms: ['gendered_pronouns_neutralised'],
    delta: delta(),
  },
  {
    attemptId: 'att_2',
    variantId: 'blind:first_person_number_swapped',
    transforms: ['first_person_number_swapped'],
    delta: delta({ abstentionChanges: 1, largestConfidenceShift: 0.5 }),
  },
]

test('n is the number of answers replayed, not the number of rewrites run against them', () => {
  expect(blindAuditReport(COMPARISONS)).toEqual({
    answersReplayed: 2,
    comparisons: 3,
    findingsCompared: 3,
    verdictChanges: 1,
    abstentionChanges: 1,
    largestConfidenceShift: 0.5,
    limitation: limitationFor(2),
    boundary: AUDIT_BOUNDARY,
  })
})

test('an audit that has run on nothing says so instead of reporting an empty success', () => {
  const report = blindAuditReport([])

  expect(report.answersReplayed).toBe(0)
  expect(report.largestConfidenceShift).toBe(0)
  expect(report.limitation).toContain('n is 0')
})

test('the limitation states the sample size it is a limitation of', () => {
  expect(limitationFor(1)).toBe(
    'n is 1. A difference across 1 answer establishes nothing about bias in either direction, ' +
      'and neither does an absence of one. This is a description of what moved, not a finding ' +
      'about the Evaluator.',
  )
  expect(limitationFor(4)).toContain('A difference across 4 answers establishes nothing')
})

// PROJECT.md §6.4 states a small-sample limitation rather than hiding it. The audit is smaller than
// the benchmark and gets the same treatment: the caveat is rendered with the numbers, not after them.
test('the rendered audit states n, the numbers, and what they do not establish', () => {
  const lines = renderBlindAudit(blindAuditReport(COMPARISONS))
  const rendered = lines.join('\n')

  expect(lines[1]).toBe('  answers replayed          2')
  expect(lines[2]).toBe('  comparisons               3 over 3 paired findings')
  expect(lines[3]).toBe('  verdicts that changed     1')
  expect(lines[4]).toBe('  abstentions that changed  1')
  expect(lines[5]).toBe('  largest confidence move   0.50')
  expect(rendered).toContain('n is 2.')
  expect(rendered).toContain('establishes nothing about bias in either direction')
  expect(rendered).toContain('neither does an absence of one')
  expect(rendered).toContain('transcript is published in full')
})

test('the report carries the boundary that it reports a delta and concludes nothing', () => {
  expect(blindAuditReport(COMPARISONS).boundary).toBe(
    'reports_a_delta_never_a_conclusion_about_bias',
  )
})
