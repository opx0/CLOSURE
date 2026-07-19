import { expect, test } from 'bun:test'
import { silentLogger, type EnqueueInput, type JobQueuePort } from '@closer/core'
import type { JobKind, JobRecord } from '@closer/contracts'
import { JobRunner } from './runner.ts'
import type { HandlerContext } from './handlers/index.ts'
import { HANDLERS } from './handlers/index.ts'

const AT = '2026-09-10T00:00:00.000Z'

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job_1',
    ownerId: 'local',
    kind: 'plan_retrieval',
    idempotencyKey: 'k',
    payload: { kind: 'plan_retrieval', horizonDays: 7 },
    state: 'leased',
    attempts: 1,
    maxAttempts: 3,
    runAfter: AT,
    leaseOwner: 'worker-1',
    leaseExpiresAt: AT,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

class RecordingQueue implements JobQueuePort {
  readonly calls: string[] = []
  constructor(private readonly toClaim: JobRecord[]) {}

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    return job({ kind: input.kind })
  }
  async claim(): Promise<JobRecord[]> {
    return this.toClaim.splice(0, this.toClaim.length)
  }
  async succeed(id: string): Promise<void> {
    this.calls.push(`succeed:${id}`)
  }
  async retry(id: string, _owner: string, error: string): Promise<void> {
    this.calls.push(`retry:${id}:${error}`)
  }
  async bury(id: string, _owner: string, error: string): Promise<void> {
    this.calls.push(`bury:${id}:${error}`)
  }
  async release(id: string): Promise<void> {
    this.calls.push(`release:${id}`)
  }
  async list(): Promise<JobRecord[]> {
    return []
  }
  async get(): Promise<JobRecord | null> {
    return null
  }
}

function runnerFor(queue: RecordingQueue, handler: () => Promise<void>) {
  const original = HANDLERS.plan_retrieval
  HANDLERS.plan_retrieval = handler
  const context = { logger: silentLogger } as unknown as HandlerContext
  const runner = new JobRunner(
    queue,
    context,
    { name: 'worker-1', pollMs: 1, leaseSeconds: 1, batch: 1 },
    silentLogger,
  )
  return { runner, restore: () => (HANDLERS.plan_retrieval = original) }
}

test('a handler that returns marks the job succeeded', async () => {
  const queue = new RecordingQueue([job()])
  const { runner, restore } = runnerFor(queue, async () => {})

  await runner.runOnce()
  restore()

  expect(queue.calls).toEqual(['succeed:job_1'])
})

test('a handler that throws below max attempts is retried, not buried', async () => {
  const queue = new RecordingQueue([job({ attempts: 1, maxAttempts: 3 })])
  const { runner, restore } = runnerFor(queue, async () => {
    throw new Error('transient')
  })

  await runner.runOnce()
  restore()

  expect(queue.calls[0]).toContain('retry:job_1')
  expect(queue.calls[0]).toContain('transient')
})

// A poison job must stop, with its error recorded. Retrying it forever is how a queue turns one bad
// row into an outage.
test('a handler that throws on the last attempt is buried with its error', async () => {
  const queue = new RecordingQueue([job({ attempts: 3, maxAttempts: 3 })])
  const { runner, restore } = runnerFor(queue, async () => {
    throw new Error('poison')
  })

  await runner.runOnce()
  restore()

  expect(queue.calls[0]).toContain('bury:job_1')
  expect(queue.calls[0]).toContain('poison')
})

test('every job kind this build knows has a handler', () => {
  const kinds: JobKind[] = [
    'ingest_repository',
    'build_export',
    'sweep_retention',
    'plan_retrieval',
    'run_benchmark',
  ]
  for (const kind of kinds) expect(typeof HANDLERS[kind]).toBe('function')
})
