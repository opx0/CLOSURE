import type { Nudge, NudgeDelivery } from '@levelhead/contracts'

// An adapter is either usable or it names exactly what it is missing. Discovering an absent API key
// at call time is how an install quietly stops nudging, so configuration is a value the caller can
// read before it decides whether anything may leave the process.
export type OutreachReadiness =
  | { state: 'ready'; provider: string }
  | { state: 'not_configured'; provider: string; missing: readonly string[] }

export interface OutreachPort {
  readonly readiness: OutreachReadiness
  // `send` does not throw. A provider that refuses the message, a provider that is down, and a
  // socket that never opened are all `rejected_by_provider` with the detail attached, because the
  // job's purpose is to record what happened to one message. Throwing would hand the message back
  // to the retry loop, and a retried message is a message the candidate may receive twice.
  send(nudge: Nudge): Promise<NudgeDelivery>
}
