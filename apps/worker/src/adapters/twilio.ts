import type { Nudge, NudgeDelivery } from '@levelhead/contracts'
import type { Clock } from '@levelhead/core'
// The outreach barrel is not re-exported from @levelhead/core yet; that wiring is the coordinator's.
import type {
  OutreachPort,
  OutreachReadiness,
} from '../../../../packages/core/src/outreach/index.ts'
import { accepted, deliver, readinessFor, rejected } from './provider.ts'

export interface TwilioSettings {
  accountSid: string | undefined
  authToken: string | undefined
  from: string | undefined
}

// https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
function endpoint(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
}

interface TwilioSendResponse {
  sid: string
}

// https://www.twilio.com/docs/api/errors
interface TwilioErrorResponse {
  code: number
  message: string
}

export class TwilioSmsOutreach implements OutreachPort {
  readonly readiness: OutreachReadiness
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly settings: TwilioSettings,
    private readonly clock: Clock,
    fetchImpl?: typeof fetch,
  ) {
    this.readiness = readinessFor('twilio', {
      TWILIO_ACCOUNT_SID: settings.accountSid,
      TWILIO_AUTH_TOKEN: settings.authToken,
      TWILIO_FROM_NUMBER: settings.from,
    })
    this.fetchImpl = fetchImpl ?? fetch
  }

  async send(nudge: Nudge): Promise<NudgeDelivery> {
    const at = this.clock.now()
    if (this.readiness.state !== 'ready') {
      return rejected(
        nudge,
        at,
        `twilio is not configured: missing ${this.readiness.missing.join(', ')}`,
      )
    }

    return deliver(nudge, at, async () => {
      const credentials = Buffer.from(
        `${this.settings.accountSid}:${this.settings.authToken}`,
        'utf8',
      ).toString('base64')
      const form = new URLSearchParams({
        To: nudge.to,
        From: String(this.settings.from),
        Body: nudge.body,
      })
      const response = await this.fetchImpl(endpoint(String(this.settings.accountSid)), {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })

      if (!response.ok) {
        const error = (await response.json()) as TwilioErrorResponse
        return rejected(nudge, at, `twilio ${error.code}: ${error.message}`)
      }
      const body = (await response.json()) as TwilioSendResponse
      return accepted(nudge, at, body.sid)
    })
  }
}
