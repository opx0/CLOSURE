import type { Clock } from '@levelhead/core'
import type { NudgeChannel } from '@levelhead/contracts'
import { DryRunOutreach, type OutreachPort } from '../../../../packages/core/src/outreach/index.ts'
import type { WorkerConfig } from '../config.ts'
import { OutreachAdapters } from './outreach.ts'
import { ResendEmailOutreach } from './resend.ts'
import { TwilioSmsOutreach } from './twilio.ts'
import { WhatsAppCloudOutreach } from './whatsapp.ts'

export * from './outreach.ts'
export * from './nudge-ledger.ts'

// Every adapter is constructed whether or not it has credentials. One that has none is not absent,
// it is a port that reports what it is missing, which is what lets the worker log a specific
// variable name instead of going quiet.
export function outreachFrom(
  config: WorkerConfig,
  clock: Clock,
  fetchImpl: typeof fetch = fetch,
): OutreachAdapters {
  const live: Record<NudgeChannel, OutreachPort> = {
    email: new ResendEmailOutreach(
      { apiKey: config.RESEND_API_KEY, from: config.NUDGE_EMAIL_FROM },
      clock,
      fetchImpl,
    ),
    sms: new TwilioSmsOutreach(
      {
        accountSid: config.TWILIO_ACCOUNT_SID,
        authToken: config.TWILIO_AUTH_TOKEN,
        from: config.TWILIO_FROM_NUMBER,
      },
      clock,
      fetchImpl,
    ),
    whatsapp: new WhatsAppCloudOutreach(
      {
        phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: config.WHATSAPP_ACCESS_TOKEN,
        graphVersion: config.WHATSAPP_GRAPH_VERSION,
      },
      clock,
      fetchImpl,
    ),
  }

  return new OutreachAdapters(live, new DryRunOutreach(clock), config.NUDGE_DELIVERY_ARMED)
}
