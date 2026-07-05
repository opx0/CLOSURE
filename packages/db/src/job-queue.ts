import { sql, type SQL } from 'drizzle-orm'
import { Value } from '@sinclair/typebox/value'
import {
  JobPayloadSchema,
  JobRecordSchema,
  LOCAL_OWNER_ID,
  type JobKind,
  type JobRecord,
  type OwnerId,
} from '@closer/contracts'
import type { ClaimInput, EnqueueInput, JobQueuePort } from '@closer/core'
import { jobs } from './schema.ts'
import { toQuery } from './postgres-event-store.ts'
import type { SqlExecutor } from './sql.ts'

const DEFAULT_MAX_ATTEMPTS = 5

const ISO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`)

function isoColumn(column: SQL, alias: string): SQL {
  return sql`to_char(${column} at time zone 'UTC', ${ISO}) as ${sql.raw(alias)}`
}

// Qualified with the table alias: the claim statement joins a CTE that also has an `id`, and an
// unqualified column there is ambiguous rather than merely untidy.
function selected(alias: string) {
  const at = (column: string) => sql.raw(`${alias}.${column}`)
  return sql`
  ${at('id')},
  ${at('owner_id')},
  ${at('kind')},
  ${at('idempotency_key')},
  ${at('payload')},
  ${at('state')},
  ${at('attempts')},
  ${at('max_attempts')},
  ${at('lease_owner')},
  ${at('last_error')},
  ${isoColumn(at('run_after'), 'run_after')},
  ${isoColumn(at('lease_expires_at'), 'lease_expires_at')},
  ${isoColumn(at('created_at'), 'created_at')},
  ${isoColumn(at('updated_at'), 'updated_at')}
`
}

const SELECTED = selected('jobs')

export function rowToJob(row: Record<string, unknown>): JobRecord {
  const candidate: unknown = {
    id: String(row['id']),
    ownerId: String(row['owner_id']),
    kind: String(row['kind']),
    idempotencyKey: String(row['idempotency_key']),
    payload: row['payload'],
    state: String(row['state']),
    attempts: Number(row['attempts']),
    maxAttempts: Number(row['max_attempts']),
    runAfter: String(row['run_after']),
    leaseOwner: row['lease_owner'] === null ? null : String(row['lease_owner']),
    leaseExpiresAt: row['lease_expires_at'] === null ? null : String(row['lease_expires_at']),
    lastError: row['last_error'] === null ? null : String(row['last_error']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  }
  if (!Value.Check(JobRecordSchema, candidate)) {
    const [first] = [...Value.Errors(JobRecordSchema, candidate)]
    throw new Error(
      `job ${String(row['id'])} does not match the job contract — ${first?.path ?? '/'}: ${first?.message ?? 'unknown'}`,
    )
  }
  return candidate
}

export function enqueueStatement(input: EnqueueInput, id: string, runAfter: string): SQL {
  if (!Value.Check(JobPayloadSchema, input.payload)) {
    throw new Error(`job payload for ${input.kind} does not match the job contract`)
  }
  return sql`
    insert into ${jobs} (
      id, owner_id, kind, idempotency_key, payload, state, attempts, max_attempts,
      run_after, created_at, updated_at
    )
    values (
      ${id}::text,
      ${input.ownerId}::text,
      ${input.kind}::text,
      ${input.idempotencyKey}::text,
      ${JSON.stringify(input.payload)}::jsonb,
      'queued',
      0,
      ${input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS}::integer,
      ${runAfter}::timestamptz,
      now(),
      now()
    )
    on conflict on constraint jobs_idempotency_uniq do update
      set updated_at = now()
    returning ${SELECTED}
  `
}

// FOR UPDATE SKIP LOCKED is what makes two workers claiming at the same instant take disjoint rows
// rather than block each other (ADR-009). An expired lease is reclaimable: a worker that died
// mid-job must not hold its row forever.
export function claimStatement(input: ClaimInput): SQL {
  const kinds = input.kinds ?? []
  const kindFilter = kinds.length === 0 ? sql`true` : sql`kind = any(${sql.param(kinds)}::text[])`

  return sql`
    with runnable as (
      select id from ${jobs}
      where ${kindFilter}
        and attempts < max_attempts
        and (
          (state = 'queued' and run_after <= now())
          or (state = 'leased' and lease_expires_at < now())
        )
      order by run_after asc, created_at asc
      for update skip locked
      limit ${input.limit ?? 1}::integer
    )
    update ${jobs} as j
    set state = 'leased',
        lease_owner = ${input.leaseOwner}::text,
        lease_expires_at = now() + make_interval(secs => ${input.leaseSeconds}::double precision),
        attempts = j.attempts + 1,
        updated_at = now()
    from runnable
    where j.id = runnable.id
    returning ${selected('j')}
  `
}

export function succeedStatement(jobId: string, leaseOwner: string): SQL {
  return sql`
    update ${jobs}
    set state = 'succeeded', lease_owner = null, lease_expires_at = null,
        last_error = null, updated_at = now()
    where id = ${jobId}::text and lease_owner = ${leaseOwner}::text and state = 'leased'
  `
}

export function retryStatement(
  jobId: string,
  leaseOwner: string,
  error: string,
  runAfter: string,
): SQL {
  return sql`
    update ${jobs}
    set state = case when attempts >= max_attempts then 'dead' else 'queued' end,
        lease_owner = null,
        lease_expires_at = null,
        last_error = ${error}::text,
        run_after = ${runAfter}::timestamptz,
        updated_at = now()
    where id = ${jobId}::text and lease_owner = ${leaseOwner}::text and state = 'leased'
  `
}

export function buryStatement(jobId: string, leaseOwner: string, error: string): SQL {
  return sql`
    update ${jobs}
    set state = 'dead', lease_owner = null, lease_expires_at = null,
        last_error = ${error}::text, updated_at = now()
    where id = ${jobId}::text and lease_owner = ${leaseOwner}::text
  `
}

// Graceful shutdown gives the row back without consuming the attempt it had already taken.
export function releaseStatement(jobId: string, leaseOwner: string): SQL {
  return sql`
    update ${jobs}
    set state = 'queued', lease_owner = null, lease_expires_at = null,
        attempts = greatest(attempts - 1, 0), updated_at = now()
    where id = ${jobId}::text and lease_owner = ${leaseOwner}::text and state = 'leased'
  `
}

export function listStatement(ownerId: OwnerId, limit: number): SQL {
  return sql`
    select ${SELECTED} from ${jobs}
    where owner_id = ${ownerId}::text
    order by created_at desc
    limit ${limit}::integer
  `
}

export function getStatement(jobId: string): SQL {
  return sql`select ${SELECTED} from ${jobs} where id = ${jobId}::text`
}

export class PostgresJobQueue implements JobQueuePort {
  readonly #sql: SqlExecutor
  readonly #newId: () => string

  constructor(executor: SqlExecutor, newId: () => string) {
    this.#sql = executor
    this.#newId = newId
  }

  async enqueue(input: EnqueueInput): Promise<JobRecord> {
    const runAfter = input.runAfter ?? new Date().toISOString()
    const { sql: text, params } = toQuery(enqueueStatement(input, this.#newId(), runAfter))
    const { rows } = await this.#sql.query(text, params)
    const row = rows[0]
    if (row === undefined) throw new Error(`enqueueing ${input.kind} returned no row`)
    return rowToJob(row)
  }

  async claim(input: ClaimInput): Promise<JobRecord[]> {
    const { sql: text, params } = toQuery(claimStatement(input))
    const { rows } = await this.#sql.query(text, params)
    return rows.map(rowToJob)
  }

  async succeed(jobId: string, leaseOwner: string): Promise<void> {
    const { sql: text, params } = toQuery(succeedStatement(jobId, leaseOwner))
    await this.#sql.query(text, params)
  }

  async retry(jobId: string, leaseOwner: string, error: string, runAfter: string): Promise<void> {
    const { sql: text, params } = toQuery(retryStatement(jobId, leaseOwner, error, runAfter))
    await this.#sql.query(text, params)
  }

  async bury(jobId: string, leaseOwner: string, error: string): Promise<void> {
    const { sql: text, params } = toQuery(buryStatement(jobId, leaseOwner, error))
    await this.#sql.query(text, params)
  }

  async release(jobId: string, leaseOwner: string): Promise<void> {
    const { sql: text, params } = toQuery(releaseStatement(jobId, leaseOwner))
    await this.#sql.query(text, params)
  }

  async list(ownerId: OwnerId = LOCAL_OWNER_ID, limit = 50): Promise<JobRecord[]> {
    const { sql: text, params } = toQuery(listStatement(ownerId, limit))
    const { rows } = await this.#sql.query(text, params)
    return rows.map(rowToJob)
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const { sql: text, params } = toQuery(getStatement(jobId))
    const { rows } = await this.#sql.query(text, params)
    const row = rows[0]
    return row === undefined ? null : rowToJob(row)
  }
}

export function idempotencyKeyFor(kind: JobKind, parts: readonly string[]): string {
  return [kind, ...parts].join(':')
}
