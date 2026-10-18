import {
  index,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const EVENTS_TABLE = 'events'
export const JOBS_TABLE = 'jobs'
export const SNAPSHOTS_TABLE = 'snapshots'
export const ARTIFACT_INDEX_TABLE = 'artifact_index'
export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'

// Append-only is enforced in the database (PROJECT.md §5.3) via this primary key plus the
// UPDATE/DELETE/TRUNCATE trigger in migrations/001_events.sql — dropping either is stop condition
// (c) firing (ticket 05 §8), not an ordinary schema change.
export const APPEND_ONLY_CONSTRAINT = 'events_session_seq_pk'
export const EVENT_ID_CONSTRAINT = 'events_event_id_key'

// The event envelope of packages/contracts/src/event.ts, column for column. Payload stays opaque
// jsonb — the seven kinds have seven shapes, and columnising the union would freeze a contract
// still moving.
export const events = pgTable(
  EVENTS_TABLE,
  {
    sessionId: text('session_id').notNull(),
    seq: integer('seq').notNull(),
    eventId: text('event_id').notNull(),
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    causedBy: text('caused_by'),
    payload: jsonb('payload').notNull(),
    // ADR-023: every user-owned row carries an owner id and every query filters on it, from the
    // first migration that could have needed one.
    ownerId: text('owner_id').notNull(),
  },
  (table) => [
    primaryKey({ name: APPEND_ONLY_CONSTRAINT, columns: [table.sessionId, table.seq] }),
    unique(EVENT_ID_CONSTRAINT).on(table.eventId),
  ],
)

// Written by the runner, not a migration — it's where migration 001 gets recorded, so it must
// exist before 001 runs.
export const schemaMigrations = pgTable(SCHEMA_MIGRATIONS_TABLE, {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  // sha256 of the file — catches a forward-only migration edited after it ran, which would
  // otherwise silently drift.
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const JOB_IDEMPOTENCY_CONSTRAINT = 'jobs_idempotency_uniq'

export const jobs = pgTable(
  JOBS_TABLE,
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    runAfter: timestamp('run_after', { withTimezone: true, mode: 'string' }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'string' }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    unique(JOB_IDEMPOTENCY_CONSTRAINT).on(table.ownerId, table.kind, table.idempotencyKey),
  ],
)

export const snapshots = pgTable(SNAPSHOTS_TABLE, {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  repoPath: text('repo_path').notNull(),
  commitSha: text('commit_sha').notNull(),
  fileCount: integer('file_count').notNull(),
  contentHash: text('content_hash').notNull(),
  pinnedAt: timestamp('pinned_at', { withTimezone: true, mode: 'string' }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  deletedReason: text('deleted_reason'),
})

export const artifactIndex = pgTable(
  ARTIFACT_INDEX_TABLE,
  {
    artifactId: text('artifact_id').primaryKey(),
    snapshotId: text('snapshot_id').notNull(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(),
    path: text('path').notNull(),
    symbol: text('symbol'),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
    body: text('body').notNull(),
    tokens: text('tokens').notNull(),
  },
  (table) => [index('artifact_index_scope_idx').on(table.ownerId, table.snapshotId)],
)

export const retrievalProfiles = pgTable('retrieval_profiles', {
  id: text('id').primaryKey(),
  dimensions: integer('dimensions').notNull(),
  profile: jsonb('profile').notNull(),
})

export const retrievalPublications = pgTable('retrieval_publications', {
  snapshotId: text('snapshot_id')
    .primaryKey()
    .references(() => snapshots.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull(),
  profileId: text('profile_id').references(() => retrievalProfiles.id),
})

export const retrievalChunks = pgTable(
  'retrieval_chunks',
  {
    ownerId: text('owner_id').notNull(),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifactIndex.artifactId, { onDelete: 'cascade' }),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    contentHash: text('content_hash').notNull(),
    body: text('body').notNull(),
    tokens: text('tokens').notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.snapshotId, table.id] })],
)

const nativeVector = customType<{ data: readonly number[]; driverData: string }>({
  dataType: () => 'public.vector',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => JSON.parse(value) as number[],
})

export const retrievalVectors = pgTable(
  'retrieval_vectors',
  {
    ownerId: text('owner_id').notNull(),
    snapshotId: text('snapshot_id').notNull(),
    chunkId: text('chunk_id').notNull(),
    profileId: text('profile_id')
      .notNull()
      .references(() => retrievalProfiles.id),
    embedding: nativeVector('embedding').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.snapshotId, table.chunkId, table.profileId] }),
  ],
)
