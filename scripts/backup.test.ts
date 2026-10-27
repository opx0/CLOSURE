import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupJsonl, restoreJsonl } from './backup.ts'
import { JsonlEventStore } from '../apps/cli/src/store/jsonl.ts'
import { EVENT_SCHEMA_VERSION } from '@levelhead/contracts'

test('backup restores readable owner events without changing originals or existing destinations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-backup-'))
  const events = join(dir, 'events'),
    exports = join(dir, 'exports'),
    backup = join(dir, 'backup'),
    restored = join(dir, 'restored')
  try {
    await mkdir(events)
    await mkdir(exports)
    const store = new JsonlEventStore(events, 'owner')
    const event = {
      eventId: 'evt_1',
      sessionId: 'ses_1',
      seq: 0,
      occurredAt: '2026-10-27T00:00:00Z',
      schemaVersion: EVENT_SCHEMA_VERSION,
      kind: 'state_change' as const,
      payload: { change: 'session_closed' as const, reason: 'practice' },
    }
    await store.append(event)
    await writeFile(join(exports, 'owner.json'), '{"export":true}')
    expect(await backupJsonl(events, exports, backup)).toBe(2)
    expect(await restoreJsonl(backup, restored)).toBe(2)
    expect(await new JsonlEventStore(join(restored, 'events'), 'owner').read('ses_1')).toEqual([
      event,
    ])
    expect(await store.read('ses_1')).toEqual([event])
    expect(await readFile(join(restored, 'exports/owner.json'), 'utf8')).toBe('{"export":true}')
    await expect(restoreJsonl(backup, restored)).rejects.toThrow()
    await expect(backupJsonl(events, exports, join(events, 'nested'))).rejects.toThrow('separate')
    await writeFile(join(backup, 'exports/owner.json'), 'corrupted')
    await expect(restoreJsonl(backup, join(dir, 'corrupt'))).rejects.toThrow('checksum')
    expect(await readdir(dir)).not.toContain('corrupt')
    await symlink('/etc/passwd', join(exports, 'link'))
    await expect(backupJsonl(events, exports, join(dir, 'unsafe'))).rejects.toThrow('Symlinks')
    expect(await readdir(dir)).not.toContain('unsafe')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('restore rejects traversal entries before creating a destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-bad-backup-'))
  try {
    const backup = join(dir, 'backup')
    await mkdir(backup)
    await writeFile(
      join(backup, 'manifest.json'),
      JSON.stringify({
        version: 1,
        store: 'jsonl',
        files: [{ path: 'events/../../escaped', sha256: 'a'.repeat(64), bytes: 0 }],
      }),
    )
    await expect(restoreJsonl(backup, join(dir, 'restored'))).rejects.toThrow(
      'Invalid backup entry',
    )
    expect(await readdir(dir)).toEqual(['backup'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
