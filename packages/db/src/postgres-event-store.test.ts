import { afterAll, expect, test } from 'bun:test'
import { EVENT_SCHEMA_VERSION, LOCAL_OWNER_ID, type AnyEvent } from '@levelhead/contracts'
import { AppendOnlyViolation } from '@levelhead/core'
import { runMigrations } from './migrations/runner.ts'
import {
  PostgresEventStore,
  appendStatement,
  eventToRow,
  readStatement,
  rowToEvent,
  toQuery,
} from './postgres-event-store.ts'
import { APPEND_ONLY_CONSTRAINT, EVENT_ID_CONSTRAINT } from './schema.ts'
import { UNIQUE_VIOLATION, type QueryResult, type SqlExecutor } from './sql.ts'
import { openTestDatabase } from './testing/postgres.ts'

const AT = '2026-09-09T10:00:00.000Z'

function event(seq: number, reason: string, sessionId = 'ses_1'): AnyEvent {
  return {
    eventId: `evt_${sessionId}_${seq}`,
    sessionId,
    seq,
    occurredAt: AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind: 'state_change',
    payload: { change: 'session_closed', reason },
  }
}

function asRow(source: AnyEvent): Record<string, unknown> {
  return { ...eventToRow(source) } as unknown as Record<string, unknown>
}

type Responder = (text: string, values: unknown[]) => QueryResult | Error

class FakeExecutor implements SqlExecutor {
  readonly #respond: Responder

  constructor(respond: Responder) {
    this.#respond = respond
  }

  async query(text: string, values: unknown[] = []): Promise<QueryResult> {
    const answer = this.#respond(text, values)
    if (answer instanceof Error) throw answer
    return answer
  }
}

function rows(...records: Record<string, unknown>[]): QueryResult {
  return { rows: records, rowCount: records.length }
}

function refused(highest: number): Responder {
  return (text) => (text.includes('insert into') ? { rows: [], rowCount: 0 } : rows({ highest }))
}

test('an envelope survives the row mapping unchanged', () => {
  const plain = event(0, 'first')
  expect(rowToEvent(asRow(plain), 'events ses_1#0')).toEqual(plain)

  const caused: AnyEvent = { ...event(1, 'second'), causedBy: 'evt_0' }
  expect(rowToEvent(asRow(caused), 'events ses_1#1')).toEqual(caused)
})

test('a null caused_by comes back as an absent key, not an undefined one', () => {
  const mapped = rowToEvent(asRow(event(0, 'first')), 'events ses_1#0')
  expect(Object.keys(mapped)).not.toContain('causedBy')
})

test('a row that does not match the envelope names its session and seq', () => {
  const corrupt = { ...asRow(event(4, 'first')), kind: 'gossip' }
  expect(() => rowToEvent(corrupt, 'events ses_1#4')).toThrow(/events ses_1#4/)
})

test('a non-canonical occurredAt is refused rather than silently folded into UTC', () => {
  const shifted: AnyEvent = { ...event(0, 'first'), occurredAt: '2026-09-09T15:30:00+05:30' }
  expect(() => appendStatement(shifted, LOCAL_OWNER_ID)).toThrow(/canonical UTC/)
})

test('the append is parameterised and gapless', () => {
  const { sql, params } = toQuery(appendStatement(event(2, 'third'), LOCAL_OWNER_ID))

  expect(sql).toContain('insert into "events"')
  expect(sql).toContain('coalesce(max(seq) + 1, 0)')
  expect(sql).not.toContain('ses_1')
  expect(params).toContain('ses_1')
})

test('the read is ordered by seq and renders occurred_at back in canonical form', () => {
  const { sql } = toQuery(readStatement('ses_1', LOCAL_OWNER_ID))

  expect(sql).toContain('order by seq asc')
  expect(sql).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`)
})

test('a rewritten seq is an AppendOnlyViolation, not a driver error', async () => {
  const store = new PostgresEventStore(new FakeExecutor(refused(1)))
  await expect(store.append(event(1, 'rewritten'))).rejects.toBeInstanceOf(AppendOnlyViolation)
})

test('a seq that would leave a hole says so', async () => {
  const store = new PostgresEventStore(new FakeExecutor(refused(0)))
  await expect(store.append(event(3, 'skipped'))).rejects.toThrow(/hole/)
})

test('the unique violation a racing writer provokes is an AppendOnlyViolation too', async () => {
  const collision = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: UNIQUE_VIOLATION,
    constraint: APPEND_ONLY_CONSTRAINT,
  })
  const store = new PostgresEventStore(new FakeExecutor(() => collision))

  await expect(store.append(event(1, 'raced'))).rejects.toBeInstanceOf(AppendOnlyViolation)
})

test('a reused event id says so rather than surfacing the constraint name', async () => {
  const collision = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: UNIQUE_VIOLATION,
    constraint: EVENT_ID_CONSTRAINT,
  })
  const store = new PostgresEventStore(new FakeExecutor(() => collision))

  await expect(store.append(event(1, 'reused'))).rejects.toThrow(/ids are minted once per event/)
})

test('a driver error that is not a constraint the adapter owns is passed through untouched', async () => {
  const outage = Object.assign(new Error('connection terminated'), { code: '08006' })
  const store = new PostgresEventStore(new FakeExecutor(() => outage))

  await expect(store.append(event(0, 'first'))).rejects.toThrow(/connection terminated/)
})

test('read maps every row and listSessions returns the ids', async () => {
  const store = new PostgresEventStore(
    new FakeExecutor((text) =>
      text.includes('distinct')
        ? rows({ session_id: 'ses_1' }, { session_id: 'ses_2' })
        : rows(asRow(event(0, 'first')), asRow(event(1, 'second'))),
    ),
  )

  expect(await store.read('ses_1')).toEqual([event(0, 'first'), event(1, 'second')])
  expect(await store.listSessions()).toEqual(['ses_1', 'ses_2'])
})

const url = process.env['DATABASE_URL']
const database = url === undefined ? undefined : await openTestDatabase(url, 'levelhead_test_store')
if (database === undefined) {
  console.log(
    '[skipped] packages/db Postgres integration tests: DATABASE_URL is unset or unreachable',
  )
}
const integration = database === undefined ? test.skip : test

afterAll(async () => {
  await database?.close()
})

integration('round-trips a session and refuses a rewrite against a real database', async () => {
  if (database === undefined) return
  await runMigrations(database.pool)
  const store = new PostgresEventStore(database.pool)

  await store.append(event(0, 'first'))
  await store.append(event(1, 'second'))

  expect(await store.read('ses_1')).toEqual([event(0, 'first'), event(1, 'second')])
  expect(await store.read('ses_unwritten')).toEqual([])
  expect(await store.listSessions()).toEqual(['ses_1'])

  await expect(store.append(event(1, 'rewritten'))).rejects.toBeInstanceOf(AppendOnlyViolation)
  await expect(store.append(event(5, 'skipped'))).rejects.toThrow(/hole/)
})

integration('the database itself refuses an UPDATE, a DELETE and a TRUNCATE', async () => {
  if (database === undefined) return
  await runMigrations(database.pool)
  const store = new PostgresEventStore(database.pool)
  await store.append(event(0, 'first', 'ses_trigger'))

  await expect(
    database.pool.query(`update events set kind = 'plan' where session_id = 'ses_trigger'`),
  ).rejects.toThrow(/append-only/)
  await expect(
    database.pool.query(`delete from events where session_id = 'ses_trigger'`),
  ).rejects.toThrow(/append-only/)
  await expect(database.pool.query('truncate events')).rejects.toThrow(/append-only/)
})
