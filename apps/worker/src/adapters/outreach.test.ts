import { expect, test } from 'bun:test'
import type { Nudge, NudgeChannel, NudgeDelivery } from '@levelhead/contracts'
import {
  DryRunOutreach,
  type OutreachPort,
  type OutreachReadiness,
} from '../../../../packages/core/src/outreach/index.ts'
import { OutreachAdapters } from './outreach.ts'

const CLOCK = { now: () => '2026-09-22T09:00:00.000Z' }

class StubOutreach implements OutreachPort {
  constructor(readonly readiness: OutreachReadiness) {}
  send(nudge: Nudge): Promise<NudgeDelivery> {
    return Promise.resolve({
      nudgeId: nudge.id,
      channel: nudge.channel,
      outcome: 'sent',
      at: CLOCK.now(),
      providerRef: 'ref_1',
      detail: null,
    })
  }
}

function adaptersWith(readiness: OutreachReadiness, armed: boolean): OutreachAdapters {
  const port = new StubOutreach(readiness)
  const live: Record<NudgeChannel, OutreachPort> = { email: port, sms: port, whatsapp: port }
  return new OutreachAdapters(live, new DryRunOutreach(CLOCK), armed)
}

const READY: OutreachReadiness = { state: 'ready', provider: 'twilio' }
const ABSENT: OutreachReadiness = {
  state: 'not_configured',
  provider: 'twilio',
  missing: ['TWILIO_ACCOUNT_SID'],
}

test('arming takes a configured provider, an armed install, and a job that asked to send', () => {
  const choice = adaptersWith(READY, true).choose('sms', false)

  expect(choice.reason).toBe('armed')
  expect(choice.provider).toBe('twilio')
  expect(choice.port.readiness).toEqual(READY)
})

test('an unconfigured provider falls back to the dry run and says which one it was', () => {
  const choice = adaptersWith(ABSENT, true).choose('sms', false)

  expect(choice.reason).toBe('provider_not_configured')
  expect(choice.provider).toBe('twilio')
  expect(choice.port.readiness).toEqual({ state: 'ready', provider: 'dry_run' })
})

test('a configured provider on an unarmed install still delivers nothing', () => {
  const choice = adaptersWith(READY, false).choose('sms', false)

  expect(choice.reason).toBe('delivery_not_armed')
  expect(choice.port.readiness).toEqual({ state: 'ready', provider: 'dry_run' })
})

// An operator should learn about a missing variable at boot, not from a nudge that never arrived.
test('the boot line names the variables each unconfigured channel is missing', () => {
  const live: Record<NudgeChannel, OutreachPort> = {
    email: new StubOutreach({ state: 'ready', provider: 'resend' }),
    sms: new StubOutreach(ABSENT),
    whatsapp: new StubOutreach({
      state: 'not_configured',
      provider: 'whatsapp_cloud',
      missing: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    }),
  }

  expect(new OutreachAdapters(live, new DryRunOutreach(CLOCK), true).describe()).toBe(
    'armed email=resend sms=twilio:missing(TWILIO_ACCOUNT_SID) ' +
      'whatsapp=whatsapp_cloud:missing(WHATSAPP_ACCESS_TOKEN,WHATSAPP_PHONE_NUMBER_ID)',
  )
})

test('a job that asked for a dry run gets one however armed the install is', () => {
  const choice = adaptersWith(READY, true).choose('sms', true)

  expect(choice.reason).toBe('job_requested_dry_run')
  expect(choice.port.readiness).toEqual({ state: 'ready', provider: 'dry_run' })
})
