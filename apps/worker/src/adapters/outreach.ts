import type { NudgeChannel } from '@levelhead/contracts'
import type { OutreachPort } from '../../../../packages/core/src/outreach/index.ts'

export type OutreachReason =
  'armed' | 'job_requested_dry_run' | 'delivery_not_armed' | 'provider_not_configured'

export interface OutreachChoice {
  port: OutreachPort
  provider: string
  reason: OutreachReason
}

export class OutreachAdapters {
  constructor(
    private readonly live: Record<NudgeChannel, OutreachPort>,
    private readonly dryRun: OutreachPort,
    private readonly armed: boolean,
  ) {}

  // The one place delivery is armed, so there is one place to read when asking why a message did or
  // did not leave. Three independent locks, all of which must be open: the job has to ask for a
  // real send, the install has to be armed, and the channel's provider has to be configured. Any
  // one shut renders the message and delivers nothing, which is what makes an install with no
  // provider account a complete and safe one rather than a broken one.
  choose(channel: NudgeChannel, jobAskedDryRun: boolean): OutreachChoice {
    const live = this.live[channel]
    if (jobAskedDryRun) {
      return { port: this.dryRun, provider: 'dry_run', reason: 'job_requested_dry_run' }
    }
    if (!this.armed) {
      return { port: this.dryRun, provider: 'dry_run', reason: 'delivery_not_armed' }
    }
    if (live.readiness.state !== 'ready') {
      return {
        port: this.dryRun,
        provider: live.readiness.provider,
        reason: 'provider_not_configured',
      }
    }
    return { port: live, provider: live.readiness.provider, reason: 'armed' }
  }

  // Printed once at boot so a missing variable is found then, rather than after the first nudge
  // that quietly turned into a dry run.
  describe(): string {
    const armed = this.armed ? 'armed' : 'dry_run'
    const channels = Object.entries(this.live).map(([channel, port]) =>
      port.readiness.state === 'ready'
        ? `${channel}=${port.readiness.provider}`
        : `${channel}=${port.readiness.provider}:missing(${port.readiness.missing.join(',')})`,
    )
    return [armed, ...channels].join(' ')
  }
}
