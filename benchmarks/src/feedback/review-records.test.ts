import { expect, test } from 'bun:test'
import { loadFeedbackCases } from './cases.ts'
import { validateReviewRecords } from './review-records.ts'

test('review validation requires real case IDs, reviewer details and verbatim evidence', async () => {
  const fixtures = await loadFeedbackCases()
  const item = fixtures.cases.find((entry) => entry.split === 'tuning' && entry.answer.length > 0)!
  const record = {
    id: item.id,
    reviewer: 'reviewer-1',
    date: '2026-10-27',
    judgment: 'partial',
    rationale: 'Review rationale.',
    quotes: [item.answer],
  }
  expect(validateReviewRecords(JSON.stringify(record), fixtures, 'tuning')).toEqual({
    count: 1,
    errors: [],
  })
  expect(
    validateReviewRecords(
      [JSON.stringify(record), JSON.stringify(record)].join('\n'),
      fixtures,
      'tuning',
    ).errors,
  ).toHaveLength(1)
  expect(
    validateReviewRecords(
      JSON.stringify({ ...record, quotes: ['invented evidence'] }),
      fixtures,
      'tuning',
    ).errors,
  ).toHaveLength(1)
  expect(validateReviewRecords(JSON.stringify(record), fixtures, 'heldout').errors).toHaveLength(1)
  expect(
    validateReviewRecords(JSON.stringify({ ...record, date: '2026-02-30' }), fixtures, 'tuning')
      .errors,
  ).toHaveLength(1)
})
