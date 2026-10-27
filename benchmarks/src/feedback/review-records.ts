import type { FeedbackCaseSet } from './cases.ts'

export function validateReviewRecords(
  text: string,
  fixtures: FeedbackCaseSet,
  split: 'tuning' | 'heldout',
): { count: number; errors: string[] } {
  const cases = new Map(
    fixtures.cases.filter((item) => item.split === split).map((item) => [item.id, item]),
  )
  const seen = new Set<string>()
  const errors: string[] = []
  let count = 0
  let reviewer: string | undefined
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    try {
      const row: unknown = JSON.parse(line)
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new Error('expected an object')
      const value = row as Record<string, unknown>
      const item = typeof value.id === 'string' ? cases.get(value.id) : undefined
      if (!item) throw new Error('unknown case or wrong split')
      if (seen.has(item.id)) throw new Error('duplicate case')
      if (typeof value.reviewer !== 'string' || !value.reviewer.trim())
        throw new Error('reviewer is required')
      if (reviewer !== undefined && value.reviewer !== reviewer)
        throw new Error('one reviewer per file')
      if (
        typeof value.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
        Number.isNaN(Date.parse(value.date)) ||
        new Date(value.date).toISOString().slice(0, 10) !== value.date
      )
        throw new Error('valid date is required')
      if (!['supported', 'partial', 'incorrect', 'abstain'].includes(String(value.judgment)))
        throw new Error('invalid judgment')
      if (typeof value.rationale !== 'string' || !value.rationale.trim())
        throw new Error('rationale is required')
      if (
        !Array.isArray(value.quotes) ||
        value.quotes.some(
          (quote) => typeof quote !== 'string' || !quote || !item.answer.includes(quote),
        )
      )
        throw new Error('quotes must occur in the final answer')
      if (!value.quotes.length && !(item.answer === '' && value.judgment === 'abstain'))
        throw new Error('answer evidence is required')
      seen.add(item.id)
      reviewer = value.reviewer
      count++
    } catch (error) {
      errors.push(`line ${index + 1}: ${error instanceof Error ? error.message : 'invalid record'}`)
    }
  }
  return { count, errors }
}
