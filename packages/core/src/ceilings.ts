import type { InvocationRecord } from '@closer/contracts'

// Ticket 10 §3: cost is authoritative for the session; tokens are a per-port sub-budget (the ~$0
// local-model Conductor is bounded by tokens, the Evaluator by cost). A breach ends the session —
// never a truncated context or partial evaluation.
export interface Ceilings {
  sessionCostUsd: number
  sessionTokens: number
  modelCallsPerTurn: number
}

export type CeilingName = 'session_cost_usd' | 'session_tokens' | 'model_calls_per_turn'

export class CeilingBreach extends Error {
  constructor(
    readonly ceiling: CeilingName,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`ceiling ${ceiling} breached: ${observed} exceeds ${limit}`)
    this.name = 'CeilingBreach'
  }
}

export class CeilingLedger {
  #costUsd = 0
  #tokens = 0
  #callsThisTurn = 0

  constructor(private readonly ceilings: Ceilings) {}

  beginTurn(): void {
    this.#callsThisTurn = 0
  }

  // Checked before, not after, the call — checking afterwards means it already breached.
  assertCanCall(): void {
    if (this.#callsThisTurn + 1 > this.ceilings.modelCallsPerTurn) {
      throw new CeilingBreach(
        'model_calls_per_turn',
        this.ceilings.modelCallsPerTurn,
        this.#callsThisTurn + 1,
      )
    }
    if (this.#costUsd >= this.ceilings.sessionCostUsd) {
      throw new CeilingBreach('session_cost_usd', this.ceilings.sessionCostUsd, this.#costUsd)
    }
    if (this.#tokens >= this.ceilings.sessionTokens) {
      throw new CeilingBreach('session_tokens', this.ceilings.sessionTokens, this.#tokens)
    }
  }

  record(invocation: InvocationRecord): void {
    this.#callsThisTurn += 1
    this.#costUsd += invocation.costUsd
    this.#tokens += invocation.inputTokens + invocation.outputTokens
  }

  totals(): { costUsd: number; tokens: number; callsThisTurn: number } {
    return { costUsd: this.#costUsd, tokens: this.#tokens, callsThisTurn: this.#callsThisTurn }
  }
}
