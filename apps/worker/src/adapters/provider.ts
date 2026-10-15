import type { Nudge, NudgeDelivery } from '@levelhead/contracts'
// The outreach barrel is not re-exported from @levelhead/core yet; that wiring is the coordinator's.
import type { OutreachReadiness } from '../../../../packages/core/src/outreach/index.ts'

export type ProviderEnv = Record<string, string | undefined>

// The operator gets the variable names, not "misconfigured". Naming them is the difference between
// a one-line fix and an afternoon.
export function readinessFor(provider: string, env: ProviderEnv): OutreachReadiness {
  const missing = Object.entries(env)
    .filter(([, value]) => value === undefined || value.trim() === '')
    .map(([name]) => name)
    .sort()
  return missing.length === 0
    ? { state: 'ready', provider }
    : { state: 'not_configured', provider, missing }
}

const DETAIL_LIMIT = 500

export function accepted(nudge: Nudge, at: string, providerRef: string): NudgeDelivery {
  return {
    nudgeId: nudge.id,
    channel: nudge.channel,
    outcome: 'sent',
    at,
    providerRef,
    detail: null,
  }
}

export function rejected(nudge: Nudge, at: string, detail: string): NudgeDelivery {
  return {
    nudgeId: nudge.id,
    channel: nudge.channel,
    outcome: 'rejected_by_provider',
    at,
    providerRef: null,
    detail: detail.slice(0, DETAIL_LIMIT),
  }
}

// A socket that never opened lands in the same place as a provider that said no: one message did
// not arrive, and the record says why. Throwing instead would hand the message back to the job
// queue's retry loop, and a retried message is a message the candidate can receive twice.
export async function deliver(
  nudge: Nudge,
  at: string,
  send: () => Promise<NudgeDelivery>,
): Promise<NudgeDelivery> {
  try {
    return await send()
  } catch (error) {
    return rejected(
      nudge,
      at,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    )
  }
}
