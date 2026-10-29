import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restorePostgres } from './postgres-backup.ts'

const source = 'postgresql://owner:secret@localhost:5432/original'
const target = 'postgresql://owner:secret@localhost:5432/restored'

test('PostgreSQL restore refuses the original database before opening its archive', async () => {
  await expect(restorePostgres('/nonexistent', source, source)).rejects.toThrow('separate')
  await expect(
    restorePostgres('/nonexistent', source, 'postgresql://other@localhost/original'),
  ).rejects.toThrow('separate')
  await expect(
    restorePostgres('/nonexistent', source, 'postgresql://other@another-host/original'),
  ).rejects.toThrow('separate')
  await expect(
    restorePostgres('/nonexistent', source, `${target}?dbname=original`),
  ).rejects.toThrow('unsupported connection options')
})

test('PostgreSQL restore rejects tampered and linked archives before connecting to a target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-pg-archive-'))
  const backup = join(dir, 'backup')
  try {
    await mkdir(backup)
    const contents = Buffer.from('synthetic archive for checksum guard only')
    const manifest = {
      version: 1,
      store: 'postgres',
      archive: 'database.dump',
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(backup, 'database.dump'), contents)
    await writeFile(join(backup, 'database.dump'), 'tampered')
    await expect(restorePostgres(backup, source, target)).rejects.toThrow('checksum')
    await rm(join(backup, 'database.dump'))
    await writeFile(join(dir, 'external.dump'), contents)
    await symlink(join(dir, 'external.dump'), join(backup, 'database.dump'))
    await expect(restorePostgres(backup, source, target)).rejects.toThrow('regular file')
    manifest.archive = '../external.dump'
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest))
    await expect(restorePostgres(backup, source, target)).rejects.toThrow('manifest')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
