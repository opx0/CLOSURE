import { expect, test } from 'bun:test'
import { ProviderHttpError } from './openai-compatible.ts'
import {
  ConcurrencyLimiter,
  classifyError,
  classifyStatus,
  guarded,
  retryDelayMs,
  withRetry,
  type RetryPolicy,
} from './resilience.ts'

const instant: RetryPolicy = {
  attempts: 3,
  baseMs: 1,
  capMs: 4,
  sleep: async () => {},
  random: () => 1,
}

test('the provider saying "later" is retryable; the provider saying "no" is not', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 529]) {
    expect(classifyStatus(status)).toBe('retryable')
  }
  for (const status of [400, 401, 403, 404, 422]) {
    expect(classifyStatus(status)).toBe('terminal')
  }
})

test('a transport failure or a timeout is retryable; anything else is terminal', () => {
  expect(classifyError(new TypeError('fetch failed'))).toBe('retryable')
  expect(classifyError(Object.assign(new Error('slow'), { name: 'TimeoutError' }))).toBe(
    'retryable',
  )
  expect(classifyError(new ProviderHttpError(429, 'slow down'))).toBe('retryable')
  expect(classifyError(new ProviderHttpError(400, 'bad request'))).toBe('terminal')
  expect(classifyError(new Error('something else'))).toBe('terminal')
})

test('a retryable failure is attempted again, up to the bound', async () => {
  let calls = 0
  const value = await withRetry(async () => {
    calls += 1
    if (calls < 3) throw new ProviderHttpError(503, 'unavailable')
    return 'ok'
  }, instant)

  expect(value).toBe('ok')
  expect(calls).toBe(3)
})

// Retrying a 400 spends money to be told the same thing again.
test('a terminal failure is never retried, and rethrows untouched', async () => {
  let calls = 0
  const attempt = withRetry(async () => {
    calls += 1
    throw new ProviderHttpError(400, 'bad request')
  }, instant)

  await expect(attempt).rejects.toBeInstanceOf(ProviderHttpError)
  expect(calls).toBe(1)
})

test('the bound holds and the last error is the one raised', async () => {
  let calls = 0
  const attempt = withRetry(async () => {
    calls += 1
    throw new ProviderHttpError(503, `attempt ${calls}`)
  }, instant)

  await expect(attempt).rejects.toThrow(/attempt 3/)
  expect(calls).toBe(3)
})

// Full jitter: equal delays across concurrent callers turn one rate limit into a synchronised
// second one, so the delay is uniform in [0, exponential] rather than exponential exactly.
test('backoff is exponential, capped, and jittered down to zero', () => {
  const policy: RetryPolicy = { attempts: 5, baseMs: 100, capMs: 800 }

  expect(retryDelayMs(1, policy, () => 1)).toBe(100)
  expect(retryDelayMs(2, policy, () => 1)).toBe(200)
  expect(retryDelayMs(4, policy, () => 1)).toBe(800)
  expect(retryDelayMs(9, policy, () => 1)).toBe(800)
  expect(retryDelayMs(3, policy, () => 0)).toBe(0)
})

test('the limiter caps in-flight calls and lets the queue drain', async () => {
  const limiter = new ConcurrencyLimiter(2)
  const release: (() => void)[] = []
  let peak = 0

  const calls = [0, 1, 2, 3, 4].map(() =>
    limiter.run(async () => {
      peak = Math.max(peak, limiter.inFlight)
      await new Promise<void>((resolve) => release.push(resolve))
    }),
  )

  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(limiter.inFlight).toBe(2)
  expect(limiter.queued).toBe(3)

  while (release.length > 0) {
    release.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  await Promise.all(calls)

  expect(peak).toBe(2)
  expect(limiter.inFlight).toBe(0)
})

test('a limiter slot is returned even when the call throws', async () => {
  const limiter = new ConcurrencyLimiter(1)

  await expect(
    limiter.run(async () => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')
  expect(limiter.inFlight).toBe(0)

  expect(await limiter.run(async () => 'next')).toBe('next')
})

test('without a resilience policy the call is made exactly once, unguarded', async () => {
  let calls = 0
  await expect(
    guarded(undefined, async () => {
      calls += 1
      throw new ProviderHttpError(503, 'unavailable')
    }),
  ).rejects.toBeInstanceOf(ProviderHttpError)
  expect(calls).toBe(1)
})
