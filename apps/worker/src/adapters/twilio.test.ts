import { expect, test } from 'bun:test'
import type { Nudge } from '@levelhead/contracts'
import { TwilioSmsOutreach } from './twilio.ts'

const CLOCK = { now: () => '2026-09-22T09:00:00.000Z' }

const NUDGE: Nudge = {
  id: 'ndg_2',
  channel: 'sms',
  to: '+15558675310',
  subject: null,
  body: 'Quick nudge: recursion is due for a retest.',
  dueAt: '2026-09-23T09:00:00.000Z',
  gapIds: ['gap_recursion'],
}

const NEVER_FETCH = (() => {
  throw new Error('fetch must not be called when twilio is not configured')
}) as unknown as typeof fetch

test('not configured: readiness names all three missing variables and send never touches the network', async () => {
  const adapter = new TwilioSmsOutreach(
    { accountSid: undefined, authToken: undefined, from: undefined },
    CLOCK,
    NEVER_FETCH,
  )

  expect(adapter.readiness).toEqual({
    state: 'not_configured',
    provider: 'twilio',
    missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
  })

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_2',
    channel: 'sms',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail:
      'twilio is not configured: missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER',
  })
})

test('a successful send parses the message sid and posts the exact request', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({
        account_sid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        api_version: '2010-04-01',
        body: 'Hi there',
        date_created: 'Thu, 24 Aug 2023 05:01:45 +0000',
        date_sent: 'Thu, 24 Aug 2023 05:01:45 +0000',
        date_updated: 'Thu, 24 Aug 2023 05:01:45 +0000',
        direction: 'outbound-api',
        error_code: null,
        error_message: null,
        from: '+15557122661',
        num_media: '0',
        num_segments: '1',
        price: null,
        price_unit: null,
        messaging_service_sid: 'MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'queued',
        subresource_uris: {
          media:
            '/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages/SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Media.json',
        },
        to: '+15558675310',
        uri: '/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages/SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  const adapter = new TwilioSmsOutreach(
    { accountSid: 'ACtest1234567890', authToken: 'secret_auth_token', from: '+15557122661' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_2',
    channel: 'sms',
    outcome: 'sent',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    detail: null,
  })

  expect(calls.length).toBe(1)
  const call = calls[0]!
  expect(call.url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest1234567890/Messages.json')
  expect(call.init.method).toBe('POST')
  expect(call.init.headers).toEqual({
    authorization: 'Basic QUN0ZXN0MTIzNDU2Nzg5MDpzZWNyZXRfYXV0aF90b2tlbg==',
    'content-type': 'application/x-www-form-urlencoded',
  })
  expect(Object.fromEntries(new URLSearchParams(call.init.body as string))).toEqual({
    To: '+15558675310',
    From: '+15557122661',
    Body: 'Quick nudge: recursion is due for a retest.',
  })
})

test('a provider refusal carries the documented code and message', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        code: 21211,
        message: "Invalid 'To' Phone Number",
        more_info: 'https://www.twilio.com/docs/errors/21211',
        status: 400,
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

  const adapter = new TwilioSmsOutreach(
    { accountSid: 'ACtest1234567890', authToken: 'secret_auth_token', from: '+15557122661' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery).toEqual({
    nudgeId: 'ndg_2',
    channel: 'sms',
    outcome: 'rejected_by_provider',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail: "twilio 21211: Invalid 'To' Phone Number",
  })
})

test('a transport fault is recorded, not thrown', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch

  const adapter = new TwilioSmsOutreach(
    { accountSid: 'ACtest1234567890', authToken: 'secret_auth_token', from: '+15557122661' },
    CLOCK,
    fetchImpl,
  )

  const delivery = await adapter.send(NUDGE)

  expect(delivery.outcome).toBe('rejected_by_provider')
  expect(delivery.detail).toContain('ECONNREFUSED')
})
