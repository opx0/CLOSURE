import { test, expect, afterEach } from 'bun:test'
import { Type } from '@sinclair/typebox'
import type { StructuredRequest } from '@levelhead/core'
import { StructuredEvaluator } from './evaluator-structured.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const VerdictSchema = Type.Object({
  verdict: Type.Union([Type.Literal('supported'), Type.Literal('contradicted')]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
})

// TypeBox's `Symbol(Kind)` annotations are dropped by JSON.stringify — what the provider actually sees.
const WIRE_SCHEMA: unknown = JSON.parse(JSON.stringify(VerdictSchema))

const request: StructuredRequest<typeof VerdictSchema> = {
  promptId: 'answer-evaluation',
  promptVersion: 3,
  promptHash: 'deadbeefdeadbeef',
  system: 'You judge one claim.',
  user: 'The candidate said X.',
  schema: VerdictSchema,
  schemaName: 'verdict',
  maxOutputTokens: 512,
}

function anthropicEvaluator(): StructuredEvaluator {
  return new StructuredEvaluator({
    modelAlias: 'claude-opus-5',
    apiKey: 'sk-test',
    localBaseUrl: 'http://localhost:8081/v1',
  })
}

function stubAnthropic(body: unknown, status = 200, capture?: { request?: unknown }): void {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    if (capture) capture.request = JSON.parse(init.body)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

function message(text: string, stopReason: string, inputTokens = 1200, outputTokens = 48): unknown {
  return {
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text },
    ],
    stop_reason: stopReason,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

test('happy path returns the validated value with computed, non-zero accounting', async () => {
  const capture: { request?: unknown } = {}
  stubAnthropic(message('{"verdict":"supported","confidence":0.8}', 'end_turn'), 200, capture)

  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ verdict: 'supported', confidence: 0.8 })

  expect(result.invocation.port).toBe('evaluator')
  expect(result.invocation.modelAlias).toBe('claude-opus-5')
  expect(result.invocation.promptId).toBe('answer-evaluation')
  expect(result.invocation.promptVersion).toBe(3)
  expect(result.invocation.promptHash).toBe('deadbeefdeadbeef')
  expect(result.invocation.inputTokens).toBe(1200)
  expect(result.invocation.outputTokens).toBe(48)
  // 1200 in at $5/MTok plus 48 out at $25/MTok — computed, not zero and not a placeholder.
  expect(result.invocation.costUsd).toBeCloseTo(0.0012 * 5 + 0.000048 * 25, 12)
  expect(result.invocation.stopReason).toBe('end_turn')

  const sent = capture.request as Record<string, unknown>
  expect(sent.system).toBe('You judge one claim.')
  expect(sent.messages).toEqual([{ role: 'user', content: 'The candidate said X.' }])
  expect(sent.max_tokens).toBe(512)
  expect(sent.output_config).toEqual({ format: { type: 'json_schema', schema: WIRE_SCHEMA } })
})

test('a refusal stop reason maps to the refusal failure', async () => {
  stubAnthropic(message('', 'refusal'))
  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure).toEqual({ kind: 'refusal' })
  // A refused call still burned input tokens and still has to be attributable.
  expect(result.invocation.inputTokens).toBe(1200)
  expect(result.invocation.costUsd).toBeGreaterThan(0)
})

test('a max_tokens stop reason maps to max_tokens even when the body happens to parse', async () => {
  stubAnthropic(message('{"verdict":"supported","confidence":0.8}', 'max_tokens'))
  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure).toEqual({ kind: 'max_tokens' })
})

test('unparseable JSON is reported with its raw body, never repaired', async () => {
  stubAnthropic(message('Sure! Here is the JSON: {verdict: supported', 'end_turn'))
  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure.kind).toBe('unparseable')
  expect(result.failure).toMatchObject({ raw: 'Sure! Here is the JSON: {verdict: supported' })
})

test('a schema mismatch reports TypeBox errors and the raw body, and returns no value', async () => {
  stubAnthropic(message('{"verdict":"mostly","confidence":4}', 'end_turn'))
  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure.kind).toBe('schema_mismatch')
  if (result.failure.kind !== 'schema_mismatch') throw new Error('unreachable')
  expect(result.failure.errors.length).toBeGreaterThan(0)
  expect(result.failure.errors.join(' ')).toContain('/verdict')
  expect(result.failure.raw).toBe('{"verdict":"mostly","confidence":4}')
  expect('value' in result).toBe(false)
})

test('an HTTP error maps to transport and still returns an invocation record', async () => {
  stubAnthropic({ error: { message: 'overloaded' } }, 529)
  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure.kind).toBe('transport')
  if (result.failure.kind !== 'transport') throw new Error('unreachable')
  expect(result.failure.message).toContain('529')
  expect(result.invocation.port).toBe('evaluator')
  expect(result.invocation.promptHash).toBe('deadbeefdeadbeef')
  expect(result.invocation.stopReason).toBe('other')
  expect(result.invocation.inputTokens).toBe(0)
})

test('a thrown fetch maps to transport rather than escaping the port', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('Unable to connect')
  }) as unknown as typeof fetch

  const result = await anthropicEvaluator().complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure).toEqual({ kind: 'transport', message: 'Unable to connect' })
})

test('with no key the Evaluator uses the local OpenAI-compatible endpoint and a free alias', async () => {
  const capture: { request?: unknown } = {}
  const urls: string[] = []
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    urls.push(url)
    capture.request = JSON.parse(init.body)
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: '{"verdict":"contradicted","confidence":0.2}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 700, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const evaluator = new StructuredEvaluator({
    modelAlias: 'local/llama.cpp',
    localBaseUrl: 'http://localhost:8081/v1',
  })
  const result = await evaluator.complete(request)

  expect(urls).toEqual(['http://localhost:8081/v1/chat/completions'])
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('unreachable')
  expect(result.value).toEqual({ verdict: 'contradicted', confidence: 0.2 })
  expect(result.invocation.inputTokens).toBe(700)
  expect(result.invocation.costUsd).toBe(0)
  expect((capture.request as Record<string, unknown>).response_format).toEqual({
    type: 'json_schema',
    json_schema: { name: 'verdict', schema: WIRE_SCHEMA, strict: true },
  })
})

test("a local content_filter finish reason still reaches ADR-012's refusal check", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

  const result = await new StructuredEvaluator({
    modelAlias: 'local/llama.cpp',
    localBaseUrl: 'http://localhost:8081/v1',
  }).complete(request)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('unreachable')
  expect(result.failure).toEqual({ kind: 'refusal' })
})
