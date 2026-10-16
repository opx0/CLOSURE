import { afterAll, expect, test } from 'bun:test'
import { LOCAL_OWNER_ID, type JobPayload } from '@levelhead/contracts'
import { backoffMs } from '@levelhead/core'
import {
  PostgresJobQueue,
  buryStatement,
  claimStatement,
  enqueueStatement,
  releaseStatement,
  retryStatement,
  rowToJob,
  succeedStatement,
} from './job-queue.ts'
import { toQuery } from './postgres-event-store.ts'
import { runMigrations } from './migrations/runner.ts'
import { openTestDatabase } from './testing/postgres.ts'

const PAYLOAD: JobPayload = { kind: 'plan_retrieval', horizonDays: 7 }
const AT = '2026-09-10T00:00:00.000Z'

test('the claim query takes disjoint rows and reclaims expired leases', () => {
  const { sql } = toQuery(claimStatement({ leaseOwner: 'worker-1', leaseSeconds: 30, limit: 2 }))

  expect(sql).toContain('for update skip locked')
  expect(sql).toContain("state = 'queued' and run_after <= now()")
  expect(sql).toContain("state = 'leased' and lease_expires_at < now()")
  // Without this an already-exhausted row would be claimed once more and then violate the
  // attempts <= max_attempts constraint instead of being buried.
  expect(sql).toContain('attempts < max_attempts')
})

test('enqueueing the same work twice is a no-op rather than two runs', () => {
  const { sql } = toQuery(
    enqueueStatement(
      { ownerId: LOCAL_OWNER_ID, kind: 'plan_retrieval', payload: PAYLOAD, idempotencyKey: 'k' },
      'job_1',
      AT,
    ),
  )

  expect(sql).toContain('on conflict on constraint jobs_idempotency_uniq do update')
})

test('every state change requires the lease it claims to hold', () => {
  for (const statement of [
    succeedStatement('job_1', 'worker-1'),
    retryStatement('job_1', 'worker-1', 'boom', AT),
    buryStatement('job_1', 'worker-1', 'boom'),
    releaseStatement('job_1', 'worker-1'),
  ]) {
    expect(toQuery(statement).sql).toContain('lease_owner =')
  }
})

test('a retry past max_attempts becomes dead rather than looping forever', () => {
  expect(toQuery(retryStatement('job_1', 'worker-1', 'boom', AT)).sql).toContain(
    "case when attempts >= max_attempts then 'dead' else 'queued' end",
  )
})

// Graceful shutdown hands the row back without spending the attempt it had already taken.
test('release gives the attempt back', () => {
  expect(toQuery(releaseStatement('job_1', 'worker-1')).sql).toContain(
    'attempts = greatest(attempts - 1, 0)',
  )
})

test('backoff is bounded, exponential and jittered', () => {
  const first = backoffMs(1, 1_000, 60_000)
  const later = backoffMs(6, 1_000, 60_000)

  expect(first).toBeGreaterThanOrEqual(750)
  expect(first).toBeLessThanOrEqual(1_250)
  expect(later).toBeLessThanOrEqual(60_000 * 1.25)
})

test('a row that does not match the job contract is refused rather than coerced', () => {
  expect(() => rowToJob({ id: 'job_1', kind: 'not_a_kind' })).toThrow(/job contract/)
})

const url = process.env.DATABASE_URL
const database = url === undefined ? undefined : await openTestDatabase(url, 'levelhead_jobs_test')

if (database === undefined) {
  test.skip('packages/db job queue integration tests: DATABASE_URL is unset or unreachable', () => {})
} else {
  await runMigrations(database.pool)
  const ids = { next: 0 }
  const queue = new PostgresJobQueue(database.pool, () => `job_${(ids.next += 1)}`)

  afterAll(() => database.close())

  test('two workers claiming at the same instant take disjoint rows', async () => {
    for (const key of ['a', 'b', 'c', 'd']) {
      await queue.enqueue({
        ownerId: LOCAL_OWNER_ID,
        kind: 'plan_retrieval',
        payload: PAYLOAD,
        idempotencyKey: key,
      })
    }

    const [first, second] = await Promise.all([
      queue.claim({ leaseOwner: 'worker-1', leaseSeconds: 60, limit: 2 }),
      queue.claim({ leaseOwner: 'worker-2', leaseSeconds: 60, limit: 2 }),
    ])

    const claimed = [...first, ...second].map((job) => job.id)
    expect(new Set(claimed).size).toBe(claimed.length)
    for (const job of [...first, ...second]) expect(job.attempts).toBe(1)
  })

  test('enqueueing the same idempotency key returns the same row', async () => {
    const once = await queue.enqueue({
      ownerId: LOCAL_OWNER_ID,
      kind: 'build_export',
      payload: { kind: 'build_export', destination: 'bundle' },
      idempotencyKey: 'export-once',
    })
    const twice = await queue.enqueue({
      ownerId: LOCAL_OWNER_ID,
      kind: 'build_export',
      payload: { kind: 'build_export', destination: 'bundle' },
      idempotencyKey: 'export-once',
    })

    expect(twice.id).toBe(once.id)
  })

  test('an expired lease is reclaimable, so a crashed worker does not hold a row forever', async () => {
    const job = await queue.enqueue({
      ownerId: LOCAL_OWNER_ID,
      kind: 'sweep_retention',
      payload: { kind: 'sweep_retention', snapshotMaxAgeDays: 90 },
      idempotencyKey: 'sweep-expiry',
    })

    const [leased] = await queue.claim({
      leaseOwner: 'dead-worker',
      leaseSeconds: 1,
      limit: 10,
      kinds: ['sweep_retention'],
    })
    expect(leased?.id).toBe(job.id)
    expect(leased?.attempts).toBe(1)

    await new Promise((resolve) => setTimeout(resolve, 1_200))
    const reclaimed = await queue.claim({
      leaseOwner: 'live-worker',
      leaseSeconds: 60,
      limit: 10,
      kinds: ['sweep_retention'],
    })
    expect(reclaimed.map((one) => one.id)).toEqual([job.id])
    expect(reclaimed[0]?.attempts).toBe(2)
  })

  test('a worker cannot complete a job it does not hold the lease on', async () => {
    const job = await queue.enqueue({
      ownerId: LOCAL_OWNER_ID,
      kind: 'plan_retrieval',
      payload: PAYLOAD,
      idempotencyKey: 'lease-guard',
    })
    const [leased] = await queue.claim({
      leaseOwner: 'worker-1',
      leaseSeconds: 60,
      limit: 10,
      kinds: ['plan_retrieval'],
    })
    expect(leased).toBeDefined()

    await queue.succeed(job.id, 'someone-else')
    expect((await queue.get(job.id))?.state).not.toBe('succeeded')
  })

  test('a job buried after its attempts stays dead with its error recorded', async () => {
    const job = await queue.enqueue({
      ownerId: LOCAL_OWNER_ID,
      kind: 'plan_retrieval',
      payload: PAYLOAD,
      idempotencyKey: 'poison',
      maxAttempts: 1,
    })
    const claimed = await queue.claim({
      leaseOwner: 'worker-1',
      leaseSeconds: 60,
      limit: 10,
      kinds: ['plan_retrieval'],
    })
    expect(claimed.some((one) => one.id === job.id)).toBe(true)

    await queue.bury(job.id, 'worker-1', 'poison job')
    const dead = await queue.get(job.id)
    expect(dead?.state).toBe('dead')
    expect(dead?.lastError).toBe('poison job')

    const again = await queue.claim({
      leaseOwner: 'worker-1',
      leaseSeconds: 60,
      limit: 10,
      kinds: ['plan_retrieval'],
    })
    expect(again.some((one) => one.id === job.id)).toBe(false)
  })

  test('one owner never sees another owner’s jobs', async () => {
    await queue.enqueue({
      ownerId: 'someone-else',
      kind: 'plan_retrieval',
      payload: PAYLOAD,
      idempotencyKey: 'theirs',
    })

    const mine = await queue.list(LOCAL_OWNER_ID, 100)
    expect(mine.every((job) => job.ownerId === LOCAL_OWNER_ID)).toBe(true)
  })
}
