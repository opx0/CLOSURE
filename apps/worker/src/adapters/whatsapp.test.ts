import { expect, test } from 'bun:test'
import type { Nudge } from '@levelhead/contracts'
import { WhatsAppCloudOutreach } from './whatsapp.ts'

const CLOCK = { now: () => '2026-09-22T09:00:00.000Z' }

const NUDGE: Nudge = {
  id: 'ndg_3',
  channel: 'whatsapp',
  to: '16505555555',
  subject: null,
  body: 'Quick nudge: recursion is due for a retest.',
  dueAt: '2026-09-23T09:00:00.000Z',
  gapIds: ['gap_recursion'],
}

const NEVER_FETCH = (() => {
  throw new Error('fetch must not be called when whatsapp is not configured')
}) as unknown as typeof fetch

test('not configured: readiness names both missing variables and send never touches the network', async () => {
  const adapter = new WhatsAppCloudOutreach(
    { phoneNumberId: undefined, accessToken: undefined, graphVersion: 'v23.0' },
    CLOCK,
    NEVER_FETCH,
  )

  expect(adapter.readiness).toEqual({
    state: 'not_configured',
    provider: 'whatsapp_cloud',
    missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  })

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_3',
    channel: 'whatsapp',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail:
      'whatsapp_cloud is not configured: missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID',
  })
})

test('a successful send parses the message id and posts the exact request', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({
        messaging_product: 'whatsapp',
        contacts: [{ input: '16505555555', wa_id: '16505555555' }],
        messages: [
          {
            id: 'wamid.HBgLMTY1MDUwNzY1MjAVAgARGBI5QTNDQTVCM0Q0Q0Q2RTY3RTcA',
            message_status: 'accepted',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const adapter = new WhatsAppCloudOutreach(
    { phoneNumberId: '1234567890', accessToken: 'test_access_token_abc', graphVersion: 'v23.0' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_3',
    channel: 'whatsapp',
    outcome: 'sent',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: 'wamid.HBgLMTY1MDUwNzY1MjAVAgARGBI5QTNDQTVCM0Q0Q0Q2RTY3RTcA',
    detail: null,
  })

  expect(calls.length).toBe(1)
  const call = calls[0]!
  expect(call.url).toBe('https://graph.facebook.com/v23.0/1234567890/messages')
  expect(call.init.method).toBe('POST')
  expect(call.init.headers).toEqual({
    authorization: 'Bearer test_access_token_abc',
    'content-type': 'application/json',
  })
  expect(JSON.parse(call.init.body as string)).toEqual({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '16505555555',
    type: 'text',
    text: { body: 'Quick nudge: recursion is due for a retest.' },
  })
})

test('a provider refusal outside the 24-hour window carries the documented code and message', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        error: {
          message:
            '(#131047) More than 24 hours have passed since the recipient last replied to the sender number',
          type: 'OAuthException',
          code: 131047,
          error_data: {
            messaging_product: 'whatsapp',
            details:
              'More than 24 hours have passed since the recipient last replied to the sender number.',
          },
          error_subcode: null,
          fbtrace_id: 'Az8or2yhqkZfEZ-_4Qn_Bam',
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

  const adapter = new WhatsAppCloudOutreach(
    { phoneNumberId: '1234567890', accessToken: 'test_access_token_abc', graphVersion: 'v23.0' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_3',
    channel: 'whatsapp',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail:
      'whatsapp_cloud 131047: (#131047) More than 24 hours have passed since the recipient last replied to the sender number',
  })
})

test('a transport fault is recorded, not thrown', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch

  const adapter = new WhatsAppCloudOutreach(
    { phoneNumberId: '1234567890', accessToken: 'test_access_token_abc', graphVersion: 'v23.0' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery.outcome).toBe('rejected_by_provider')
  expect(delivery.detail).toContain('ECONNREFUSED')
})
