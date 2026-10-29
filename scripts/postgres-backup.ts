import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Pool } from 'pg'

interface PgManifest {
  version: 1
  store: 'postgres'
  archive: 'database.dump'
  sha256: string
  bytes: number
}

function databaseName(connection: string): string {
  let url: URL
  try {
    url = new URL(connection)
  } catch {
    throw new Error('Invalid PostgreSQL connection URL')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1))
    throw new Error('A PostgreSQL URL with an explicit database name is required')
  if (
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !['sslmode', 'sslrootcert', 'connect_timeout'].includes(key),
    )
  )
    throw new Error('Database URL has unsupported connection options')
  return decodeURIComponent(url.pathname.slice(1))
}

async function checksum(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { sha256: hash.digest('hex'), bytes }
}

function runPostgres(command: 'pg_dump' | 'pg_restore', args: string[], connection: string) {
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, {
      env: { ...process.env, PGDATABASE: connection },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    child.stderr.resume()
    child.on('error', (error) => fail(new Error(`${command} could not start: ${error.message}`)))
    child.on('close', (code) => {
      // libpq error output can echo a connection URL; never return it to callers or logs.
      if (code === 0) done()
      else fail(new Error(`${command} failed (exit ${code}); inspect database and tool versions`))
    })
  })
}

export async function backupPostgres(connection: string, destination: string): Promise<void> {
  databaseName(connection)
  const parent = await realpath(dirname(resolve(destination)))
  const target = join(parent, basename(resolve(destination)))
  await mkdir(target, { mode: 0o700 })
  try {
    const archive = join(target, 'database.dump')
    await runPostgres(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', '--no-password', '--file', archive],
      connection,
    )
    const { sha256, bytes } = await checksum(archive)
    if (!bytes) throw new Error('Empty PostgreSQL archive')
    await writeFile(
      join(target, 'manifest.json'),
      JSON.stringify({
        version: 1,
        store: 'postgres',
        archive: 'database.dump',
        sha256,
        bytes,
      } satisfies PgManifest),
      { flag: 'wx', mode: 0o600 },
    )
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
}

export async function restorePostgres(
  backup: string,
  sourceConnection: string,
  targetConnection: string,
): Promise<void> {
  // A different hostname may still reach the same cluster (localhost versus 127.0.0.1).
  // Require a distinct database name even across hosts; the target is always disposable.
  if (databaseName(sourceConnection) === databaseName(targetConnection))
    throw new Error('Restore database must be separate from the source database')
  const root = await realpath(backup)
  if ((await readdir(root)).sort().join(',') !== 'database.dump,manifest.json')
    throw new Error('PostgreSQL backup contains unexpected files')
  const manifest: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('version' in manifest) ||
    manifest.version !== 1 ||
    !('store' in manifest) ||
    manifest.store !== 'postgres' ||
    !('archive' in manifest) ||
    manifest.archive !== 'database.dump' ||
    !('sha256' in manifest) ||
    typeof manifest.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
    !('bytes' in manifest) ||
    !Number.isSafeInteger(manifest.bytes) ||
    Number(manifest.bytes) < 1
  )
    throw new Error('Invalid PostgreSQL backup manifest')
  const archive = join(root, 'database.dump')
  const info = await lstat(archive)
  if (!info.isFile() || (await realpath(archive)) !== archive)
    throw new Error('PostgreSQL archive must be a regular file, not a symlink')
  const actual = await checksum(archive)
  if (actual.bytes !== manifest.bytes || actual.sha256 !== manifest.sha256)
    throw new Error('PostgreSQL archive checksum mismatch')

  const pool = new Pool({
    connectionString: targetConnection,
    connectionTimeoutMillis: 5000,
    max: 1,
  })
  try {
    const contents = await pool.query<{ populated: boolean }>(
      `select exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg_toast%' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        union all
        select 1 from pg_namespace n
        where n.nspname not in ('public', 'pg_catalog', 'information_schema')
          and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'
      ) as populated`,
    )
    if (contents.rows[0]?.populated) throw new Error('Restore database is not empty')
  } finally {
    await pool.end()
  }
  await runPostgres(
    'pg_restore',
    [
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      archive,
    ],
    targetConnection,
  )
}

if (import.meta.main) {
  const [action, path, confirmation] = process.argv.slice(2)
  const source = process.env.DATABASE_URL
  if (!source) throw new Error('DATABASE_URL is required')
  if (action === 'backup' && path && confirmation === '--writers-stopped') {
    await backupPostgres(source, path)
    console.log(
      'PostgreSQL archive created. Restore to a separate empty database before relying on recovery.',
    )
  } else if (action === 'restore' && path && confirmation === '--to-empty-database') {
    const destination = process.env.LEVELHEAD_RESTORE_DATABASE_URL
    if (!destination) throw new Error('LEVELHEAD_RESTORE_DATABASE_URL is required')
    await restorePostgres(path, source, destination)
    console.log(
      'PostgreSQL archive restored to the separate empty database. Verify the application before cutover.',
    )
  } else {
    throw new Error(
      'Usage: bun run data:pg:backup NEW_DIRECTORY --writers-stopped OR bun run data:pg:restore BACKUP_DIRECTORY --to-empty-database',
    )
  }
}
