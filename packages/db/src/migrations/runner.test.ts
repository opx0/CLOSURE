import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadMigrations,
  planMigrations,
  runMigrations,
  type AppliedMigration,
  type Migration,
} from './runner.ts'
import { openTestDatabase } from '../testing/postgres.ts'

function migration(version: number, name: string, sql = `-- ${name}`): Migration {
  return {
    version,
    name,
    file: `${String(version).padStart(3, '0')}_${name}.sql`,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  }
}

function recordOf(source: Migration): AppliedMigration {
  return { version: source.version, name: source.name, checksum: source.checksum }
}

test('the shipped migrations parse and are ordered', async () => {
  const migrations = await loadMigrations()

  expect(migrations.map((m) => m.file)).toEqual([
    '001_events.sql',
    '002_tenancy.sql',
    '003_jobs.sql',
    '004_retrieval.sql',
    '005_session_hygiene.sql',
  ])
  expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5])
  expect(migrations[0]?.sql).toContain('CREATE TABLE events')
  expect(migrations[2]?.sql).toContain('CREATE TABLE jobs')
})

test('an empty database runs everything in order', () => {
  const available = [migration(2, 'later'), migration(1, 'first')]

  expect(planMigrations(available, []).map((m) => m.version)).toEqual([1, 2])
})

test('an applied migration is not run again', () => {
  const first = migration(1, 'first')
  const second = migration(2, 'later')

  expect(planMigrations([first, second], [recordOf(first)]).map((m) => m.version)).toEqual([2])
  expect(planMigrations([first, second], [recordOf(first), recordOf(second)])).toEqual([])
})

test('a migration numbered behind an applied one is refused', () => {
  const second = migration(2, 'later')
  const backfilled = migration(1, 'sneaked-in')

  expect(() => planMigrations([backfilled, second], [recordOf(second)])).toThrow(
    /numbered behind version 2/,
  )
})

test('a migration edited after it was applied is refused', () => {
  const applied = recordOf(migration(1, 'first', '-- original'))

  expect(() => planMigrations([migration(1, 'first', '-- edited')], [applied])).toThrow(
    /changed after it was applied/,
  )
})

test('a database ahead of this build is refused', () => {
  expect(() =>
    planMigrations([migration(1, 'first')], [recordOf(migration(2, 'from-the-future'))]),
  ).toThrow(/not in this build/)
})

test('two files claiming one version are refused', () => {
  expect(() => planMigrations([migration(1, 'first'), migration(1, 'also-first')], [])).toThrow(
    /both claim version 1/,
  )
})

test('a file that does not announce its order is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-migrations-'))
  try {
    await writeFile(join(dir, 'add-index.sql'), '-- unnumbered', 'utf8')
    await expect(loadMigrations(dir)).rejects.toThrow(/is not a migration/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const url = process.env['DATABASE_URL']
const database =
  url === undefined ? undefined : await openTestDatabase(url, 'levelhead_test_migrate')
if (database === undefined) {
  console.log(
    '[skipped] packages/db migration integration tests: DATABASE_URL is unset or unreachable',
  )
}
const integration = database === undefined ? test.skip : test

afterAll(async () => {
  await database?.close()
})

integration('applies once and records what it applied', async () => {
  if (database === undefined) return

  expect((await runMigrations(database.pool)).applied.map((m) => m.file)).toEqual([
    '001_events.sql',
    '002_tenancy.sql',
    '003_jobs.sql',
    '004_retrieval.sql',
    '005_session_hygiene.sql',
  ])
  expect((await runMigrations(database.pool)).applied).toEqual([])

  const { rows } = await database.pool.query(
    'select version, name from schema_migrations order by version',
  )
  expect(rows).toEqual([
    { version: 1, name: 'events' },
    { version: 2, name: 'tenancy' },
    { version: 3, name: 'jobs' },
    { version: 4, name: 'retrieval' },
    { version: 5, name: 'session_hygiene' },
  ])
})
