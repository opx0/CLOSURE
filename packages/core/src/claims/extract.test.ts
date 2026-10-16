import { test, expect } from 'bun:test'
import type { Static, TSchema } from '@sinclair/typebox'
import type { InvocationRecord } from '@levelhead/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { EvaluatorPort, StructuredRequest, StructuredResult } from '../ports/evaluator.ts'
import { extractClaims, type ExtractedClaims, type ExtractionResult } from './extract.ts'

const invocation: InvocationRecord = {
  id: 'inv-1',
  port: 'evaluator',
  modelAlias: 'fake-model',
  promptId: 'claim-extraction',
  promptVersion: 1,
  promptHash: 'fakehash',
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0,
  stopReason: 'end_turn',
  latencyMs: 1,
  occurredAt: '2000-01-01T00:00:00.000Z',
}

const clock: Clock = { now: () => '2026-09-09T12:00:00.000Z' }

function counterIds(): IdSource {
  const counts = new Map<string, number>()
  return {
    next(prefix) {
      const n = (counts.get(prefix) ?? 0) + 1
      counts.set(prefix, n)
      return `${prefix}-${n}`
    },
  }
}

function fakeEvaluator(result: StructuredResult<ExtractedClaims>) {
  const requests: StructuredRequest<TSchema>[] = []
  const port: EvaluatorPort = {
    complete: async <T extends TSchema>(request: StructuredRequest<T>) => {
      requests.push(request)
      return result as unknown as StructuredResult<Static<T>>
    },
  }
  return { port, requests }
}

function proposing(claims: ExtractedClaims['claims']) {
  return fakeEvaluator({ ok: true, value: { claims }, invocation })
}

function extracted(result: ExtractionResult) {
  if ('failed' in result) throw new Error(`expected an extraction, got ${result.failed.kind}`)
  return result
}

const RESUME = 'Built a durable job queue with PostgreSQL processing ~10k jobs/day.'

test('a quote that is not in the résumé loses its claim instead of gaining a span', async () => {
  const { port } = proposing([
    {
      quote: 'Built a resilient job queue on Postgres',
      assertion: 'built a durable job queue',
      type: 'built',
      technologies: ['PostgreSQL'],
      metrics: [],
      implied: false,
    },
  ])

  const result = extracted(
    await extractClaims({
      resumeText: RESUME,
      sourceId: 'src-resume',
      evaluator: port,
      ids: counterIds(),
      clock,
    }),
  )

  expect(result.claims).toHaveLength(0)
  expect(result.spans).toHaveLength(0)
  expect(result.rejected).toEqual([
    {
      quote: 'Built a resilient job queue on Postgres',
      reason: 'quote does not appear in the résumé verbatim',
    },
  ])
})

test('a quote after a multi-byte character gets byte offsets that slice back to the quote', async () => {
  // é is two bytes and the em dash is three, so a character index is wrong here by four.
  const resume = 'Café — Led a team of 4 engineers to ship the payments rewrite.'
  const quote = 'Led a team of 4 engineers'

  const { port } = proposing([
    {
      quote,
      assertion: 'led a team of four engineers',
      type: 'led',
      technologies: [],
      metrics: ['4 engineers'],
      implied: false,
    },
  ])

  const result = extracted(
    await extractClaims({
      resumeText: resume,
      sourceId: 'src-resume',
      evaluator: port,
      ids: counterIds(),
      clock,
    }),
  )

  const span = result.spans[0]
  if (span === undefined) throw new Error('expected a span')

  expect(span.startByte).toBe(10)
  expect(span.startByte).not.toBe(resume.indexOf(quote))

  const bytes = new TextEncoder().encode(resume)
  const sliced = new TextDecoder().decode(bytes.slice(span.startByte, span.endByte))
  expect(sliced).toBe(span.quoted)
  expect(sliced).toBe(quote)
})

test('an implied claim comes back flagged and unconfirmed, attributed to the prompt', async () => {
  const { port } = proposing([
    {
      quote: 'Built a durable job queue with PostgreSQL processing ~10k jobs/day',
      assertion: 'built a durable job queue on PostgreSQL',
      type: 'built',
      technologies: ['PostgreSQL'],
      metrics: ['~10k jobs/day'],
      implied: false,
    },
    {
      quote: 'Built a durable job queue with PostgreSQL processing ~10k jobs/day',
      assertion: 'the queue survives worker failure',
      type: 'designed',
      technologies: [],
      metrics: [],
      implied: true,
    },
  ])

  const result = extracted(
    await extractClaims({
      resumeText: RESUME,
      sourceId: 'src-resume',
      evaluator: port,
      ids: counterIds(),
      clock,
    }),
  )

  expect(result.claims.map((claim) => claim.implied)).toEqual([false, true])
  expect(result.claims.every((claim) => claim.confirmedByCandidate === false)).toBe(true)
  expect(
    result.claims.every((claim) =>
      /^claim-extraction@v1#[0-9a-f]{16}$/.test(claim.extractorVersion),
    ),
  ).toBe(true)
  // Both claims quote the same line, so each still gets its own span record.
  expect(new Set(result.claims.map((claim) => claim.spanId)).size).toBe(2)
  expect(result.invocation.occurredAt).toBe('2026-09-09T12:00:00.000Z')
})

test('a repeated quote keeps its claim, on the first occurrence, and records the ambiguity', async () => {
  const resume = 'Optimized the checkout.\nOptimized the checkout.'
  const { port } = proposing([
    {
      quote: 'Optimized the checkout.',
      assertion: 'optimized the checkout',
      type: 'optimized',
      technologies: [],
      metrics: [],
      implied: false,
    },
  ])

  const result = extracted(
    await extractClaims({
      resumeText: resume,
      sourceId: 'src-resume',
      evaluator: port,
      ids: counterIds(),
      clock,
    }),
  )

  expect(result.claims).toHaveLength(1)
  expect(result.spans[0]?.startByte).toBe(0)
  expect(result.rejected[0]?.reason).toBe(
    'quote appears 2 times; the span points at the first occurrence',
  )
})

test('a refusal propagates as a failure, never as an empty claim list', async () => {
  const { port } = fakeEvaluator({ ok: false, failure: { kind: 'refusal' }, invocation })

  const result = await extractClaims({
    resumeText: RESUME,
    sourceId: 'src-resume',
    evaluator: port,
    ids: counterIds(),
    clock,
  })

  if (!('failed' in result)) throw new Error('expected a failure')
  expect(result.failed.kind).toBe('refusal')
  expect('claims' in result).toBe(false)
  expect(result.invocation.occurredAt).toBe('2026-09-09T12:00:00.000Z')
})

test('a truncated response is a max_tokens failure, not a short list', async () => {
  const { port } = fakeEvaluator({ ok: false, failure: { kind: 'max_tokens' }, invocation })

  const result = await extractClaims({
    resumeText: RESUME,
    sourceId: 'src-resume',
    evaluator: port,
    ids: counterIds(),
    clock,
    maxOutputTokens: 64,
  })

  if (!('failed' in result)) throw new Error('expected a failure')
  expect(result.failed.kind).toBe('max_tokens')
})

test('the résumé reaches the model only as fenced data', async () => {
  const { port, requests } = proposing([])

  await extractClaims({
    resumeText: RESUME,
    sourceId: 'src-resume',
    evaluator: port,
    ids: counterIds(),
    clock,
  })

  const request = requests[0]
  if (request === undefined) throw new Error('expected a request')
  expect(request.system).not.toContain(RESUME)
  expect(request.user).toContain('<<<UNTRUSTED_RESUME>>>')
  expect(request.promptId).toBe('claim-extraction')
  expect(request.maxOutputTokens).toBe(4096)
})
