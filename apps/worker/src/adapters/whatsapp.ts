import type { Nudge, NudgeDelivery } from '@levelhead/contracts'
import type { Clock } from '@levelhead/core'
// The outreach barrel is not re-exported from @levelhead/core yet; that wiring is the coordinator's.
import type {
  OutreachPort,
  OutreachReadiness,
} from '../../../../packages/core/src/outreach/index.ts'
import { accepted, deliver, readinessFor, rejected } from './provider.ts'

export interface WhatsAppSettings {
  phoneNumberId: string | undefined
  accessToken: string | undefined
  graphVersion: string
}

// https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
function endpoint(graphVersion: string, phoneNumberId: string): string {
  return `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`
}

interface WhatsAppSendResponse {
  messages: { id: string }[]
}

// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
interface WhatsAppErrorResponse {
  error: { message: string; code: number; error_subcode?: number }
}

export class WhatsAppCloudOutreach implements OutreachPort {
  readonly readiness: OutreachReadiness
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly settings: WhatsAppSettings,
    private readonly clock: Clock,
    fetchImpl?: typeof fetch,
  ) {
    this.readiness = readinessFor('whatsapp_cloud', {
      WHATSAPP_PHONE_NUMBER_ID: settings.phoneNumberId,
      WHATSAPP_ACCESS_TOKEN: settings.accessToken,
    })
    this.fetchImpl = fetchImpl ?? fetch
  }

  async send(nudge: Nudge): Promise<NudgeDelivery> {
    const at = this.clock.now()
    if (this.readiness.state !== 'ready') {
      return rejected(
        nudge,
        at,
        `whatsapp_cloud is not configured: missing ${this.readiness.missing.join(', ')}`,
      )
    }

    return deliver(nudge, at, async () => {
      const response = await this.fetchImpl(
        endpoint(this.settings.graphVersion, String(this.settings.phoneNumberId)),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.settings.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: nudge.to,
            type: 'text',
            // Free-form text is only deliverable inside the 24-hour customer service window that
            // opens when the candidate last messaged this number. Outside it, Meta rejects the send
            // with code 131047 and a template is required instead — which is exactly why this is a
            // recorded rejected_by_provider delivery rather than something the caller must catch.
            text: { body: nudge.body },
          }),
        },
      )

      if (!response.ok) {
        const error = (await response.json()) as WhatsAppErrorResponse
        return rejected(nudge, at, `whatsapp_cloud ${error.error.code}: ${error.error.message}`)
      }
      const body = (await response.json()) as WhatsAppSendResponse
      return accepted(nudge, at, body.messages[0]!.id)
    })
  }
}
