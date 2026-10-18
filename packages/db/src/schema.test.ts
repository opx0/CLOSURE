import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getTableColumns } from 'drizzle-orm'
import {
  APPEND_ONLY_CONSTRAINT,
  EVENT_ID_CONSTRAINT,
  artifactIndex,
  events,
  jobs,
  snapshots,
  retrievalProfiles,
  retrievalPublications,
  retrievalChunks,
  retrievalVectors,
} from './schema.ts'
import { MIGRATIONS_DIR, loadMigrations } from './migrations/runner.ts'

const migration = await readFile(join(MIGRATIONS_DIR, '001_events.sql'), 'utf8')
const allMigrations = (await loadMigrations()).map((entry) => entry.sql).join('\n')

test('the append-only trigger refuses UPDATE, DELETE and TRUNCATE', () => {
  expect(migration).toMatch(
    /CREATE (OR REPLACE )?FUNCTION events_reject_mutation\(\) RETURNS trigger/,
  )
  expect(migration).toMatch(/BEFORE UPDATE ON events\s+FOR EACH ROW EXECUTE FUNCTION/)
  expect(migration).toMatch(/BEFORE DELETE ON events\s+FOR EACH ROW EXECUTE FUNCTION/)
  expect(migration).toMatch(/BEFORE TRUNCATE ON events\s+FOR EACH STATEMENT EXECUTE FUNCTION/)
  expect(migration).toMatch(/RAISE EXCEPTION 'events is append-only/)
})

test('the migration states that dropping the invariant is the stop condition firing', () => {
  expect(migration).toMatch(/stop condition/)
})

test('the append-only constraint is on (session_id, seq)', () => {
  expect(migration).toContain(`CONSTRAINT ${APPEND_ONLY_CONSTRAINT} PRIMARY KEY (session_id, seq)`)
  expect(migration).toContain(`CONSTRAINT ${EVENT_ID_CONSTRAINT} UNIQUE (event_id)`)
})

// The Drizzle tables and the SQL files are two statements of one shape, and only the SQL runs —
// a column missing from one compiles and then fails in production.
test('every column in every Drizzle table exists in the migrations', () => {
  for (const table of [
    events,
    jobs,
    snapshots,
    artifactIndex,
    retrievalProfiles,
    retrievalPublications,
    retrievalChunks,
    retrievalVectors,
  ]) {
    for (const column of Object.values(getTableColumns(table))) {
      expect(allMigrations).toContain(column.name)
    }
  }
})

test('hybrid migration requires native exact pgvector and immutable encoding profiles', () => {
  expect(allMigrations).toContain('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public')
  expect(allMigrations).toContain('embedding public.vector NOT NULL')
  expect(allMigrations).toContain('retrieval_profile_immutable BEFORE UPDATE OR DELETE')
  expect(allMigrations).toContain('public.vector_dims(NEW.embedding)')
  expect(allMigrations).not.toMatch(/USING (hnsw|ivfflat)/i)
})

test('the ownership boundary is a column and an index, not a convention', () => {
  expect(allMigrations).toContain('ADD COLUMN owner_id text NOT NULL')
  expect(allMigrations).toContain('CREATE INDEX events_owner_session_seq ON events (owner_id')
  expect(allMigrations).toContain('CONSTRAINT events_owner_id_shape CHECK')
})

test('the job table claims with FOR UPDATE SKIP LOCKED behind a partial index', () => {
  expect(allMigrations).toContain('CREATE INDEX jobs_runnable ON jobs')
  expect(allMigrations).toContain("WHERE state IN ('queued', 'leased')")
  expect(allMigrations).toContain('CONSTRAINT jobs_idempotency_uniq UNIQUE')
})
