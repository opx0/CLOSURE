import type { Nudge, NudgeDelivery } from '@levelhead/contracts'
import type { Clock } from '@levelhead/core'
// The outreach barrel is not re-exported from @levelhead/core yet; that wiring is the coordinator's.
import type {
  OutreachPort,
  OutreachReadiness,
} from '../../../../packages/core/src/outreach/index.ts'
import { accepted, deliver, readinessFor, rejected } from './provider.ts'

export interface ResendSettings {
  apiKey: string | undefined
  from: string | undefined
}

// https://resend.com/docs/api-reference/emails/send-email
const ENDPOINT = 'https://api.resend.com/emails'

interface ResendSendResponse {
  id: string
}

// https://resend.com/docs/api-reference/errors
interface ResendErrorResponse {
  statusCode: number
  name: string
  message: string
}

export class ResendEmailOutreach implements OutreachPort {
  readonly readiness: OutreachReadiness
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly settings: ResendSettings,
    private readonly clock: Clock,
    fetchImpl?: typeof fetch,
  ) {
    this.readiness = readinessFor('resend', {
      RESEND_API_KEY: settings.apiKey,
      NUDGE_EMAIL_FROM: settings.from,
    })
    this.fetchImpl = fetchImpl ?? fetch
  }

  async send(nudge: Nudge): Promise<NudgeDelivery> {
    const at = this.clock.now()
    if (this.readiness.state !== 'ready') {
      return rejected(
        nudge,
        at,
        `resend is not configured: missing ${this.readiness.missing.join(', ')}`,
      )
    }
    // The renderer sets a subject for every email nudge; a null one here means the wrong channel's
    // output reached this adapter, and sending it as blank is worse than refusing it.
    if (nudge.subject === null) {
      return rejected(nudge, at, 'email nudge has no subject')
    }

    return deliver(nudge, at, async () => {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.settings.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.settings.from,
          to: [nudge.to],
          subject: nudge.subject,
          text: nudge.body,
        }),
      })

      if (!response.ok) {
        const error = (await response.json()) as ResendErrorResponse
        return rejected(nudge, at, `resend ${error.statusCode} ${error.name}: ${error.message}`)
      }
      const body = (await response.json()) as ResendSendResponse
      return accepted(nudge, at, body.id)
    })
  }
}
