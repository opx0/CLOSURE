import type { Nudge, NudgeDelivery } from '@levelhead/contracts'
import type { Clock } from '../ports/clock.ts'
import type { OutreachPort, OutreachReadiness } from './port.ts'

// The default, and the reason an install with no provider account is a complete one: every message
// is rendered in full, recorded, and delivered nowhere. There is no transport in this file, so no
// configuration mistake can turn it into one.
export class DryRunOutreach implements OutreachPort {
  readonly readiness: OutreachReadiness = { state: 'ready', provider: 'dry_run' }
  readonly rendered: Nudge[] = []

  constructor(private readonly clock: Clock) {}

  send(nudge: Nudge): Promise<NudgeDelivery> {
    this.rendered.push(nudge)
    return Promise.resolve({
      nudgeId: nudge.id,
      channel: nudge.channel,
      outcome: 'dry_run',
      at: this.clock.now(),
      providerRef: null,
      detail: null,
    })
  }
}
