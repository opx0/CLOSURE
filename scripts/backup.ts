import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

interface Entry {
  path: string
  sha256: string
  bytes: number
}
interface Manifest {
  version: 1
  store: 'jsonl'
  files: Entry[]
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const within = (root: string, path: string) => path === root || path.startsWith(root + sep)

async function regularFile(root: string, path: string): Promise<Buffer> {
  const canonical = await realpath(path)
  if (!within(root, canonical) || canonical !== resolve(path))
    throw new Error('Source escapes its root or uses a symlink')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > 64 * 1024 * 1024)
      throw new Error('Expected a regular file <=64 MiB')
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('Source changed during backup; stop writers')
    return bytes
  } finally {
    await handle.close()
  }
}

async function inventory(root: string, prefix: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Symlinks are not supported in backups')
      if (info.isDirectory()) await walk(path)
      else {
        if (!info.isFile()) throw new Error('Backups support regular files only')
        const bytes = await regularFile(root, path)
        entries.push({
          path: `${prefix}/${relative(root, path).split(sep).join('/')}`,
          sha256: digest(bytes),
          bytes: bytes.length,
        })
        if (entries.length > 10_000) throw new Error('Backup exceeds 10000 files')
      }
    }
  }
  await walk(root)
  return entries
}

async function newDestination(destination: string): Promise<string> {
  const parent = await realpath(dirname(resolve(destination)))
  const target = join(parent, basename(resolve(destination)))
  await mkdir(target, { mode: 0o700 })
  return target
}

export async function backupJsonl(
  eventDir: string,
  exportDir: string,
  destination: string,
): Promise<number> {
  for (const path of [eventDir, exportDir]) {
    if (!(await lstat(path)).isDirectory())
      throw new Error('Backup roots must be existing directories, without symlinks')
  }
  const roots = { events: await realpath(eventDir), exports: await realpath(exportDir) }
  const target = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)))
  for (const root of Object.values(roots)) {
    if (within(root, target) || within(target, root))
      throw new Error('Backup destination must be separate from data roots')
  }
  const files = [
    ...(await inventory(roots.events, 'events')),
    ...(await inventory(roots.exports, 'exports')),
  ]
  const created = await newDestination(target)
  try {
    for (const entry of files) {
      const [kind, ...parts] = entry.path.split('/')
      const root = kind === 'events' ? roots.events : roots.exports
      const bytes = await regularFile(root, join(root, ...parts))
      if (digest(bytes) !== entry.sha256)
        throw new Error('Source changed during backup; stop writers')
      const output = join(created, entry.path)
      await mkdir(dirname(output), { recursive: true, mode: 0o700 })
      await writeFile(output, bytes, { flag: 'wx', mode: 0o600 })
    }
    // Detect additions/removals/changes that occurred while copying.
    const final = [
      ...(await inventory(roots.events, 'events')),
      ...(await inventory(roots.exports, 'exports')),
    ]
    if (JSON.stringify(files) !== JSON.stringify(final))
      throw new Error('Source changed during backup; stop writers')
    await writeFile(
      join(created, 'manifest.json'),
      JSON.stringify({ version: 1, store: 'jsonl', files } satisfies Manifest),
      { flag: 'wx', mode: 0o600 },
    )
    return files.length
  } catch (error) {
    await rm(created, { recursive: true, force: true })
    throw error
  }
}

export async function restoreJsonl(backup: string, destination: string): Promise<number> {
  const root = await realpath(backup)
  const manifest: unknown = JSON.parse(
    (await regularFile(root, join(root, 'manifest.json'))).toString('utf8'),
  )
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !('version' in manifest) ||
    manifest.version !== 1 ||
    !('store' in manifest) ||
    manifest.store !== 'jsonl' ||
    !('files' in manifest) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10_000
  )
    throw new Error('Invalid backup manifest')
  const seen = new Set<string>()
  const files: Entry[] = []
  for (const item of manifest.files as unknown[]) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('path' in item) ||
      typeof item.path !== 'string' ||
      !('sha256' in item) ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !('bytes' in item) ||
      !Number.isSafeInteger(item.bytes) ||
      Number(item.bytes) < 0 ||
      isAbsolute(item.path) ||
      item.path.includes('\\') ||
      !/^(events|exports)\//.test(item.path) ||
      item.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      seen.has(item.path)
    )
      throw new Error('Invalid backup entry')
    seen.add(item.path)
    files.push({ path: item.path, sha256: item.sha256, bytes: Number(item.bytes) })
  }
  const target = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)))
  if (within(root, target) || within(target, root))
    throw new Error('Restore destination must be separate from backup')
  const created = await newDestination(target)
  try {
    for (const entry of files) {
      const source = join(root, entry.path)
      if ((await lstat(source)).isSymbolicLink()) throw new Error('Symlinks are not supported')
      const bytes = await regularFile(root, source)
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
        throw new Error('Backup checksum mismatch')
      const output = join(created, entry.path)
      await mkdir(dirname(output), { recursive: true, mode: 0o700 })
      await writeFile(output, bytes, { flag: 'wx', mode: 0o600 })
    }
    await mkdir(join(created, 'events'), { recursive: true, mode: 0o700 })
    await mkdir(join(created, 'exports'), { recursive: true, mode: 0o700 })
    return files.length
  } catch (error) {
    await rm(created, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const destination = process.argv[2]
  if (!destination || process.argv[3] !== '--writers-stopped')
    throw new Error(
      'Usage: bun run data:backup NEW_DIRECTORY --writers-stopped (stop server/CLI/worker first)',
    )
  if ((process.env.LEVELHEAD_STORE ?? 'jsonl') !== 'jsonl')
    throw new Error('This command backs up JSONL only; PostgreSQL requires a database backup')
  const count = await backupJsonl(
    process.env.LEVELHEAD_EVENT_DIR ?? '.levelhead/events',
    process.env.LEVELHEAD_EXPORT_DIR ?? '.levelhead/exports',
    destination,
  )
  console.log(
    `Backed up ${count} files. JSONL/events and exports only; no DB, repository checkout, configuration secrets or model assets. Writer shutdown is your assertion, not detected.`,
  )
}
