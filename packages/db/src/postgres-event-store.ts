import { sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { LOCAL_OWNER_ID, type AnyEvent, type OwnerId } from '@closer/contracts'
import { AppendOnlyViolation, readEvent, type EventStore } from '@closer/core'
import { APPEND_ONLY_CONSTRAINT, EVENT_ID_CONSTRAINT, events } from './schema.ts'
import { UNIQUE_VIOLATION, driverFault, type SqlExecutor } from './sql.ts'

const dialect = new PgDialect()

export interface BoundQuery {
  sql: string
  params: unknown[]
}

// Drizzle supplies schema mapping and parameter binding; this turns a built statement into a value
// a test can assert with no database behind it.
export function toQuery(statement: SQL): BoundQuery {
  const { sql: text, params } = dialect.sqlToQuery(statement)
  return { sql: text, params: [...params] }
}

export interface EventRow {
  session_id: string
  seq: number
  event_id: string
  kind: string
  occurred_at: string
  schema_version: number
  caused_by: string | null
  payload: unknown
}

// Postgres folds a timestamptz offset into UTC, so a non-canonical occurredAt would silently become
// a different string — replay identity is a byte comparison, so this refuses rather than converts.
function canonicalTimestamp(event: AnyEvent): string {
  const parsed = new Date(event.occurredAt)
  const canonical = Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
  if (canonical !== event.occurredAt) {
    throw new Error(
      `event ${event.sessionId}#${event.seq} has occurredAt ${JSON.stringify(event.occurredAt)}, which is not canonical UTC ISO-8601; timestamptz would store it as ${JSON.stringify(canonical)} and the replayed event would no longer match the written one`,
    )
  }
  return canonical
}

export function eventToRow(event: AnyEvent): EventRow {
  return {
    session_id: event.sessionId,
    seq: event.seq,
    event_id: event.eventId,
    kind: event.kind,
    occurred_at: canonicalTimestamp(event),
    schema_version: event.schemaVersion,
    caused_by: event.causedBy ?? null,
    payload: event.payload,
  }
}

export function rowToEvent(row: Record<string, unknown>, context: string): AnyEvent {
  const causedBy = row['caused_by']
  const candidate: unknown = {
    eventId: row['event_id'],
    sessionId: row['session_id'],
    seq: row['seq'],
    occurredAt: row['occurred_at'],
    schemaVersion: row['schema_version'],
    kind: row['kind'],
    payload: row['payload'],
    // Spread, not an explicit undefined: under exactOptionalPropertyTypes an absent causedBy and
    // one set to undefined are different values, and only the first round-trips.
    ...(causedBy === null || causedBy === undefined ? {} : { causedBy }),
  }
  // Upcast first, then validate: an old row must reach its upcaster before anything rejects it
  // (STACK §6). A row that still fails is a corrupt log that can't be repaired in place — the
  // trigger forbids it — so this throws rather than warns.
  return readEvent(candidate, context)
}

// Rendered via to_char, matching eventToRow's canonical form, so the round trip is the identity
// rather than whatever the driver's date parser produces today.
const OCCURRED_AT_UTC = sql`to_char(${events.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

// The WHERE makes the gapless check atomic — two writers racing the same seq can both pass it, and
// the primary key settles the race, which is why the duplicate case is handled twice below.
export function appendStatement(event: AnyEvent, ownerId: OwnerId): SQL {
  const row = eventToRow(event)
  return sql`
    insert into ${events} (
      session_id, seq, event_id, kind, occurred_at, schema_version, caused_by, payload, owner_id
    )
    select
      ${row.session_id}::text,
      ${row.seq}::integer,
      ${row.event_id}::text,
      ${row.kind}::text,
      ${row.occurred_at}::timestamptz,
      ${row.schema_version}::integer,
      ${row.caused_by}::text,
      ${JSON.stringify(row.payload)}::jsonb,
      ${ownerId}::text
    where ${row.seq}::integer = (
      select coalesce(max(seq) + 1, 0) from ${events}
      where session_id = ${row.session_id}::text and owner_id = ${ownerId}::text
    )
  `
}

export function readStatement(sessionId: string, ownerId: OwnerId): SQL {
  return sql`
    select
      session_id,
      seq,
      event_id,
      kind,
      schema_version,
      caused_by,
      payload,
      ${OCCURRED_AT_UTC} as occurred_at
    from ${events}
    where session_id = ${sessionId}::text and owner_id = ${ownerId}::text
    order by seq asc
  `
}

export function listSessionsStatement(ownerId: OwnerId): SQL {
  return sql`
    select distinct session_id from ${events}
    where owner_id = ${ownerId}::text
    order by session_id asc
  `
}

export function highestSeqStatement(sessionId: string, ownerId: OwnerId): SQL {
  return sql`
    select coalesce(max(seq), -1)::integer as highest
    from ${events}
    where session_id = ${sessionId}::text and owner_id = ${ownerId}::text
  `
}

// Implements the same EventStore contract as the JSONL adapter, over the same envelope — what makes
// migrate-from-jsonl.ts a replay, not a rewrite.
export class PostgresEventStore implements EventStore {
  readonly #sql: SqlExecutor
  readonly #ownerId: OwnerId

  constructor(executor: SqlExecutor, ownerId: OwnerId = LOCAL_OWNER_ID) {
    this.#sql = executor
    this.#ownerId = ownerId
  }

  get ownerId(): OwnerId {
    return this.#ownerId
  }

  // A store scoped to a different owner reads and writes a disjoint set of rows; nothing above it
  // has to remember to filter (ADR-023).
  forOwner(ownerId: OwnerId): PostgresEventStore {
    return new PostgresEventStore(this.#sql, ownerId)
  }

  async append(event: AnyEvent): Promise<void> {
    const { sql: text, params } = toQuery(appendStatement(event, this.#ownerId))

    let inserted: number | null
    try {
      inserted = (await this.#sql.query(text, params)).rowCount
    } catch (error) {
      throw this.#translate(event, error)
    }
    if (inserted === 1) return

    // Refused by its own WHERE means seq wasn't max + 1 — #refusal distinguishes a rewrite (edited
    // log) from a hole (missing event).
    throw await this.#refusal(event)
  }

  async read(sessionId: string): Promise<AnyEvent[]> {
    const { sql: text, params } = toQuery(readStatement(sessionId, this.#ownerId))
    const { rows } = await this.#sql.query(text, params)
    return rows.map((row) => rowToEvent(row, `events ${sessionId}#${String(row['seq'])}`))
  }

  async listSessions(): Promise<string[]> {
    const { sql: text, params } = toQuery(listSessionsStatement(this.#ownerId))
    const { rows } = await this.#sql.query(text, params)
    return rows.map((row) => String(row['session_id']))
  }

  #translate(event: AnyEvent, error: unknown): unknown {
    const fault = driverFault(error)
    if (fault?.code !== UNIQUE_VIOLATION) return error
    if (fault.constraint === APPEND_ONLY_CONSTRAINT) {
      return new AppendOnlyViolation(event.sessionId, event.seq)
    }
    if (fault.constraint === EVENT_ID_CONSTRAINT) {
      return new Error(
        `event id ${event.eventId} is already in the log; ids are minted once per event`,
        { cause: error },
      )
    }
    return error
  }

  async #refusal(event: AnyEvent): Promise<Error> {
    const { sql: text, params } = toQuery(highestSeqStatement(event.sessionId, this.#ownerId))
    const { rows } = await this.#sql.query(text, params)
    const highest = Number(rows[0]?.['highest'] ?? -1)

    if (event.seq <= highest) return new AppendOnlyViolation(event.sessionId, event.seq)
    return new Error(
      `event ${event.sessionId}#${event.seq} would leave a hole after #${highest}; the log is gapless`,
    )
  }
}
