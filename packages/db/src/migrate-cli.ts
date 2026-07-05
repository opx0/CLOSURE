import { Pool } from 'pg'
import { runMigrations } from './index.ts'

// One place that owns a real connection; DATABASE_URL has no default — a migration against the
// wrong database has no undo.
const url = process.env.DATABASE_URL
if (url === undefined || url === '') {
  process.stderr.write('DATABASE_URL is not set; refusing to guess which database to migrate.\n')
  process.exit(1)
}

const pool = new Pool({ connectionString: url })
try {
  const { applied } = await runMigrations(pool)
  for (const migration of applied) {
    process.stdout.write(`applied ${migration.version} ${migration.name}\n`)
  }
  if (applied.length === 0) process.stdout.write('already up to date\n')
} finally {
  await pool.end()
}
