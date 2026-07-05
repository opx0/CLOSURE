import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_MIGRATIONS_TABLE } from '../schema.ts'
import type { SqlClient, SqlExecutor, SqlPool } from '../sql.ts'

const FILE_PATTERN = /^(\d{3,})_([a-z0-9]+(?:[-_][a-z0-9]+)*)\.sql$/

// Read off disk rather than inlined — the point of plain-SQL migrations is that what a reviewer
// reads is what runs.
export const MIGRATIONS_DIR = fileURLToPath(new URL('.', import.meta.url))

export interface Migration {
  version: number
  name: string
  file: string
  sql: string
  checksum: string
}

export interface AppliedMigration {
  version: number
  name: string
  checksum: string
}

export interface MigrationReport {
  applied: { version: number; name: string; file: string }[]
}

// Created by the runner, not by 001: the runner needs somewhere to record 001.
const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
    version    integer     PRIMARY KEY,
    name       text        NOT NULL,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)`

function byVersionAsc(a: { version: number }, b: { version: number }): number {
  return a.version - b.version
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()
  const migrations: Migration[] = []
  for (const file of files) {
    const match = FILE_PATTERN.exec(file)
    // A file that does not announce its order is a file whose order depends on how it was listed.
    if (match === null) {
      throw new Error(`${file} is not a migration; migrations are named <number>_<name>.sql`)
    }
    const [, digits = '', name = ''] = match
    const sql = await readFile(join(dir, file), 'utf8')
    migrations.push({
      version: Number(digits),
      name,
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    })
  }
  return migrations.sort(byVersionAsc)
}

// Pure, so the rules below are testable without a database rather than only discoverable against one.
export function planMigrations(
  available: readonly Migration[],
  applied: readonly AppliedMigration[],
): Migration[] {
  const byVersion = new Map<number, Migration>()
  for (const migration of available) {
    const clash = byVersion.get(migration.version)
    if (clash !== undefined) {
      throw new Error(
        `${clash.file} and ${migration.file} both claim version ${migration.version}; the order between them is undefined`,
      )
    }
    byVersion.set(migration.version, migration)
  }

  const done = new Set<number>()
  for (const record of applied) {
    const migration = byVersion.get(record.version)
    // The database is ahead of the code — continuing would layer this build's migrations onto
    // history it can't see.
    if (migration === undefined) {
      throw new Error(
        `migration ${record.version} (${record.name}) is applied to this database but is not in this build`,
      )
    }
    // An applied migration is frozen — if the file changed, a fresh build no longer produces the
    // schema the database actually has.
    if (migration.checksum !== record.checksum) {
      throw new Error(
        `migration ${migration.file} changed after it was applied (recorded ${record.checksum.slice(0, 12)}, file ${migration.checksum.slice(0, 12)}); forward-only migrations are never edited`,
      )
    }
    done.add(record.version)
  }

  const highest = applied.reduce((top, record) => Math.max(top, record.version), 0)
  const pending = [...byVersion.values()].filter((m) => !done.has(m.version)).sort(byVersionAsc)

  // A migration numbered behind one that already ran would apply after it here and before it on a
  // database built from scratch — one repository, two schemas.
  const late = pending.find((migration) => migration.version < highest)
  if (late !== undefined) {
    throw new Error(
      `migration ${late.file} is numbered behind version ${highest}, which is already applied; a forward-only migration may only be added ahead of the highest applied version`,
    )
  }

  return pending
}

async function readApplied(executor: SqlExecutor): Promise<AppliedMigration[]> {
  const { rows } = await executor.query(
    `SELECT version, name, checksum FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version ASC`,
  )
  return rows.map((row) => ({
    version: Number(row['version']),
    name: String(row['name']),
    checksum: String(row['checksum']),
  }))
}

async function applyOne(client: SqlClient, migration: Migration): Promise<void> {
  // Commits together with the row recording it — an unrecorded migration would run again on the
  // next deploy.
  await client.query('BEGIN')
  try {
    await client.query(migration.sql)
    await client.query(
      `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`migration ${migration.file} failed: ${messageOf(error)}`, { cause: error })
  }
}

// ADR-008: migrations run as a separate step, never on API process boot.
export async function runMigrations(
  pool: SqlPool,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationReport> {
  await pool.query(SCHEMA_MIGRATIONS_DDL)
  const pending = planMigrations(await loadMigrations(dir), await readApplied(pool))

  const client = await pool.connect()
  try {
    for (const migration of pending) await applyOne(client, migration)
  } finally {
    client.release()
  }

  return {
    applied: pending.map(({ version, name, file }) => ({ version, name, file })),
  }
}
