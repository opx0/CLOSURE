import { expect, test } from 'bun:test'
import type { Nudge } from '@levelhead/contracts'
import { ResendEmailOutreach } from './resend.ts'

const CLOCK = { now: () => '2026-09-22T09:00:00.000Z' }

const NUDGE: Nudge = {
  id: 'ndg_1',
  channel: 'email',
  to: 'candidate@example.com',
  subject: 'Recursion is due for a retest',
  body: 'Quick nudge: recursion is due for a retest.',
  dueAt: '2026-09-23T09:00:00.000Z',
  gapIds: ['gap_recursion'],
}

const NEVER_FETCH = (() => {
  throw new Error('fetch must not be called when resend is not configured')
}) as unknown as typeof fetch

test('not configured: readiness names both missing variables and send never touches the network', async () => {
  const adapter = new ResendEmailOutreach(
    { apiKey: undefined, from: undefined },
    CLOCK,
    NEVER_FETCH,
  )

  expect(adapter.readiness).toEqual({
    state: 'not_configured',
    provider: 'resend',
    missing: ['NUDGE_EMAIL_FROM', 'RESEND_API_KEY'],
  })

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_1',
    channel: 'email',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail: 'resend is not configured: missing NUDGE_EMAIL_FROM, RESEND_API_KEY',
  })
})

test('an email nudge with no subject is rejected before any request is built', async () => {
  const adapter = new ResendEmailOutreach(
    { apiKey: 're_test_123', from: 'Levelhead <nudges@levelhead.dev>' },
    CLOCK,
    NEVER_FETCH,
  )

  const delivery = await adapter.send({ ...NUDGE, subject: null })

  expect(delivery).toEqual({
    nudgeId: 'ndg_1',
    channel: 'email',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail: 'email nudge has no subject',
  })
})

test('a successful send parses the message id and posts the exact request', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const adapter = new ResendEmailOutreach(
    { apiKey: 're_test_123', from: 'Levelhead <nudges@levelhead.dev>' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_1',
    channel: 'email',
    outcome: 'sent',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
    detail: null,
  })

  expect(calls.length).toBe(1)
  const call = calls[0]!
  expect(call.url).toBe('https://api.resend.com/emails')
  expect(call.init.method).toBe('POST')
  expect(call.init.headers).toEqual({
    authorization: 'Bearer re_test_123',
    'content-type': 'application/json',
  })
  expect(JSON.parse(call.init.body as string)).toEqual({
    from: 'Levelhead <nudges@levelhead.dev>',
    to: ['candidate@example.com'],
    subject: 'Recursion is due for a retest',
    text: 'Quick nudge: recursion is due for a retest.',
  })
})

test('a provider refusal carries the documented code and message', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ statusCode: 401, name: 'validation_error', message: 'API key is invalid' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

  const adapter = new ResendEmailOutreach(
    { apiKey: 're_test_123', from: 'Levelhead <nudges@levelhead.dev>' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_1',
    channel: 'email',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail: 'resend 401 validation_error: API key is invalid',
  })
})

test('a transport fault is recorded, not thrown', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch

  const adapter = new ResendEmailOutreach(
    { apiKey: 're_test_123', from: 'Levelhead <nudges@levelhead.dev>' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery.outcome).toBe('rejected_by_provider')
  expect(delivery.detail).toContain('ECONNREFUSED')
})
