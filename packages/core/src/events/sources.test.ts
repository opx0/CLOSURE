import { expect, test } from 'bun:test'
import type { Span } from '@levelhead/contracts'
import { locateQuote, resolveSpan, spanViolations } from './sources.ts'

// 'café' is 5 bytes over 4 characters, '☕' is 3 bytes over 1 — the failure this module catches.
const RESUME = 'café ☕ shipped a queue, then shipped a queue again'
const sources = new Map([['src_resume', RESUME]])

function span(fields: Partial<Span>): Span {
  return { id: 'sp1', sourceId: 'src_resume', startByte: 0, endByte: 0, quoted: '', ...fields }
}

test('a span resolves when its byte offsets hold the quoted text exactly', () => {
  const located = locateQuote(RESUME, 'shipped a queue')
  expect(located).toEqual({ startByte: 10, endByte: 25, occurrences: 2 })

  const resolved = resolveSpan(
    span({ startByte: 10, endByte: 25, quoted: 'shipped a queue' }),
    sources,
  )
  expect(resolved.ok).toBe(true)
  expect(resolved.ok && Buffer.from(resolved.bytes).toString('utf8')).toBe('shipped a queue')
})

test('a character offset mistaken for a byte offset is rejected', () => {
  // `indexOf` counts characters: 7 here, where the byte offset is 10.
  expect(RESUME.indexOf('shipped')).toBe(7)

  const resolved = resolveSpan(
    span({ startByte: 7, endByte: 7 + 'shipped a queue'.length, quoted: 'shipped a queue' }),
    sources,
  )
  expect(resolved.ok).toBe(false)
  expect(resolved.ok === false && resolved.reason).toContain('not the quoted')
})

test('an off-by-one is rejected in both directions', () => {
  const short = resolveSpan(
    span({ startByte: 10, endByte: 24, quoted: 'shipped a queue' }),
    sources,
  )
  const long = resolveSpan(span({ startByte: 9, endByte: 25, quoted: 'shipped a queue' }), sources)
  expect(short.ok).toBe(false)
  expect(long.ok).toBe(false)
})

test('a span cut through the middle of a multi-byte character is rejected', () => {
  // '☕' occupies bytes 6..9; starting at 7 lands inside it.
  const resolved = resolveSpan(span({ startByte: 7, endByte: 9, quoted: '☕' }), sources)
  expect(resolved.ok).toBe(false)
})

test('a span past the end of its source, or with no source, is rejected', () => {
  const past = resolveSpan(span({ startByte: 0, endByte: 10_000, quoted: RESUME }), sources)
  expect(past.ok === false && past.reason).toContain('runs past the end')

  const orphan = resolveSpan(span({ sourceId: 'src_missing', quoted: '' }), sources)
  expect(orphan.ok === false && orphan.reason).toContain('no source src_missing')
})

test('locateQuote never guesses', () => {
  expect(locateQuote(RESUME, 'Shipped a queue')).toBeNull()
  expect(locateQuote(RESUME, 'shipped  a queue')).toBeNull()
  expect(locateQuote(RESUME, 'shipped a queue.')).toBeNull()
  expect(locateQuote(RESUME, '')).toBeNull()
  expect(locateQuote(RESUME, 'café')).toEqual({ startByte: 0, endByte: 5, occurrences: 1 })
})

test('spanViolations reports only the spans that do not resolve', () => {
  const violations = spanViolations(
    [
      span({ id: 'good', startByte: 10, endByte: 25, quoted: 'shipped a queue' }),
      span({ id: 'shifted', startByte: 7, endByte: 22, quoted: 'shipped a queue' }),
      span({ id: 'orphan', sourceId: 'src_missing', quoted: '' }),
    ],
    sources,
  )
  expect(violations.map((v) => v.spanId)).toEqual(['shifted', 'orphan'])
})
