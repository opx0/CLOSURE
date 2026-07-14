import { ProviderHttpError } from './openai-compatible.ts'

// STACK §9.4. Two separate concerns, deliberately not merged: a *retry* decides whether one failed
// call is worth attempting again, and a *limiter* decides how many calls may be in flight at once.
// Retrying a terminal failure wastes money; not limiting concurrency is how a burst of jobs earns a
// provider-side rate limit that then looks like a model problem.

export const DEFAULT_ATTEMPTS = 3
export const DEFAULT_BASE_MS = 500
export const DEFAULT_CAP_MS = 20_000
export const DEFAULT_IN_FLIGHT = 4

export type FailureClass = 'retryable' | 'terminal'

// 408/425/429 and 5xx are the provider saying "later". 400/401/403/404/422 and a content filter are
// the provider saying "no", and asking again changes nothing.
export function classifyStatus(status: number): FailureClass {
  if (status === 408 || status === 425 || status === 429) return 'retryable'
  return status >= 500 ? 'retryable' : 'terminal'
}

export function classifyError(error: unknown): FailureClass {
  if (error instanceof ProviderHttpError) return classifyStatus(error.status)
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'retryable'
  }
  // A transport error — DNS, connection reset, socket hang-up — is the same class as a 5xx.
  return error instanceof TypeError ? 'retryable' : 'terminal'
}

export interface RetryPolicy {
  attempts: number
  baseMs: number
  capMs: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: DEFAULT_ATTEMPTS,
  baseMs: DEFAULT_BASE_MS,
  capMs: DEFAULT_CAP_MS,
}

// Full jitter: the delay is uniform in [0, exponential]. Equal delays across concurrent callers is
// what turns one rate limit into a synchronised second one.
export function retryDelayMs(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(random() * exponential)
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(
  call: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
): Promise<T> {
  const sleep = policy.sleep ?? wait
  const random = policy.random ?? Math.random

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      // The last attempt and every terminal failure rethrow untouched: the caller must see the
      // provider's own error, not a wrapper that hides which failure it was.
      if (attempt >= policy.attempts || classifyError(error) === 'terminal') throw error
      await sleep(retryDelayMs(attempt, policy, random))
    }
  }
}

// FIFO, so a queued call cannot be starved by later ones. Global across both ports on purpose:
// the provider counts requests, not which port made them.
export class ConcurrencyLimiter {
  #inFlight = 0
  readonly #waiting: (() => void)[] = []

  constructor(private readonly limit: number = DEFAULT_IN_FLIGHT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`concurrency limit must be a positive integer, got ${limit}`)
    }
  }

  get inFlight(): number {
    return this.#inFlight
  }

  get queued(): number {
    return this.#waiting.length
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.#inFlight >= this.limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve))
    }
    this.#inFlight += 1
    try {
      return await call()
    } finally {
      this.#inFlight -= 1
      this.#waiting.shift()?.()
    }
  }
}

export interface ProviderResilience {
  retry: RetryPolicy
  limiter: ConcurrencyLimiter
}

export function defaultResilience(
  inFlight: number = DEFAULT_IN_FLIGHT,
  retry: RetryPolicy = DEFAULT_RETRY,
): ProviderResilience {
  return { retry, limiter: new ConcurrencyLimiter(inFlight) }
}

// One entry point, so a new call site cannot forget either half.
export function guarded<T>(
  resilience: ProviderResilience | undefined,
  call: () => Promise<T>,
): Promise<T> {
  if (resilience === undefined) return call()
  return resilience.limiter.run(() => withRetry(call, resilience.retry))
}
