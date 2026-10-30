import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupJsonl, restoreJsonl } from './backup.ts'
import { JsonlEventStore } from '../apps/cli/src/store/jsonl.ts'
import { EVENT_SCHEMA_VERSION, type AnyEvent } from '@levelhead/contracts'
import { citationAvailability, replay } from '@levelhead/core'

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

test('v2 backup restores worker plans and nudge claims while v1 remains readable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-worker-backup-'))
  const events = join(dir, 'events'),
    exports = join(dir, 'exports'),
    plans = join(dir, 'plans'),
    nudges = join(dir, 'nudges')
  try {
    for (const path of [events, exports, plans, nudges]) await mkdir(path)
    await writeFile(join(events, 'owner.jsonl'), '{"event":1}\n')
    await writeFile(join(plans, 'owner.jsonl'), '{"due":"later"}\n')
    await writeFile(join(nudges, 'claim.jsonl'), '{"attempted":true}\n')
    const backup = join(dir, 'backup')
    expect(await backupJsonl(events, exports, backup, { plans, nudges })).toBe(3)
    expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')).version).toBe(2)
    const restored = join(dir, 'restored')
    expect(await restoreJsonl(backup, restored)).toBe(3)
    expect(await readFile(join(restored, 'plans/owner.jsonl'), 'utf8')).toBe('{"due":"later"}\n')
    expect(await readFile(join(restored, 'nudges/claim.jsonl'), 'utf8')).toBe(
      '{"attempted":true}\n',
    )
    const legacy = join(dir, 'legacy')
    expect(await backupJsonl(events, exports, legacy)).toBe(1)
    expect(await restoreJsonl(legacy, join(dir, 'legacy-restored'))).toBe(1)
    expect((await readdir(join(dir, 'legacy-restored'))).sort()).toEqual(['events', 'exports'])
    await mkdir(join(legacy, 'plans'))
    await expect(restoreJsonl(legacy, join(dir, 'legacy-unlisted'))).rejects.toThrow(
      'unexpected payload root',
    )
    expect(await readdir(dir)).not.toContain('legacy-unlisted')
    await writeFile(join(backup, 'plans/unlisted.jsonl'), '{"unlisted":true}\n')
    await expect(restoreJsonl(backup, join(dir, 'incomplete'))).rejects.toThrow(
      'does not cover every payload file',
    )
    expect(await readdir(dir)).not.toContain('incomplete')
    await rm(join(backup, 'plans/unlisted.jsonl'))
    await writeFile(join(backup, 'nudges/claim.jsonl'), 'tampered')
    await expect(restoreJsonl(backup, join(dir, 'tampered'))).rejects.toThrow('checksum')
    expect(await readdir(dir)).not.toContain('tampered')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('v3 backup restores benchmark outputs beside exports without changing the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-benchmark-backup-'))
  const events = join(dir, 'events')
  const exports = join(dir, 'exports')
  const plans = join(dir, 'plans')
  const nudges = join(dir, 'nudges')
  const benchmarks = join(dir, 'benchmarks')
  try {
    for (const path of [events, exports, plans, nudges, benchmarks]) await mkdir(path)
    await mkdir(join(benchmarks, 'run-1'))
    const report = '{"synthetic":true,"gates":[]}'
    await writeFile(join(benchmarks, 'run-1', 'report.json'), report)
    const backup = join(dir, 'backup')
    expect(
      await backupJsonl(
        events,
        exports,
        backup,
        { plans, nudges, benchmarks },
        {
          LEVELHEAD_STORE: 'jsonl',
          LEVELHEAD_EVENT_DIR: events,
          DATABASE_URL: 'postgres://user:secret@localhost/db',
          MODEL_PROVIDER_API_KEY: 'private-model-key',
        },
      ),
    ).toBe(1)
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as {
      version: number
      settings: Record<string, string>
    }
    expect(manifest.version).toBe(3)
    expect(manifest.settings).toEqual({ LEVELHEAD_STORE: 'jsonl', LEVELHEAD_EVENT_DIR: events })
    expect(JSON.stringify(manifest)).not.toContain('secret')
    expect(JSON.stringify(manifest)).not.toContain('private-model-key')
    const restored = join(dir, 'restored')
    expect(await restoreJsonl(backup, restored)).toBe(1)
    expect(await readFile(join(restored, 'benchmarks/run-1/report.json'), 'utf8')).toBe(report)
    expect(JSON.parse(await readFile(join(restored, 'recovery-settings.json'), 'utf8'))).toEqual(
      manifest.settings,
    )
    expect(await readFile(join(benchmarks, 'run-1/report.json'), 'utf8')).toBe(report)
    expect((await readdir(restored)).sort()).toEqual([
      'benchmarks',
      'events',
      'exports',
      'nudges',
      'plans',
      'recovery-settings.json',
    ])
    await mkdir(join(backup, 'extra'))
    await expect(restoreJsonl(backup, join(dir, 'unlisted'))).rejects.toThrow(
      'unexpected payload root',
    )
    expect(await readdir(dir)).not.toContain('unlisted')
    await rm(join(backup, 'extra'), { recursive: true })
    manifest.settings.DATABASE_URL = 'postgres://user:secret@localhost/db'
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(manifest))
    await expect(restoreJsonl(backup, join(dir, 'secret-settings'))).rejects.toThrow(
      'Invalid backup settings',
    )
    expect(await readdir(dir)).not.toContain('secret-settings')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an event-only install can be backed up before its first export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-event-only-'))
  try {
    const events = join(dir, 'events')
    await mkdir(events)
    await writeFile(join(events, 'local.jsonl'), '{"event":1}\n')
    const backup = join(dir, 'backup')
    expect(await backupJsonl(events, join(dir, 'exports'), backup)).toBe(1)
    const restored = join(dir, 'restored')
    expect(await restoreJsonl(backup, restored)).toBe(1)
    expect(await readdir(join(restored, 'exports'))).toEqual([])
    expect(await readFile(join(restored, 'events/local.jsonl'), 'utf8')).toBe('{"event":1}\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a separate restore replays deleted citations and preserves the scheduled plan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-restore-replay-'))
  const events = join(dir, 'events')
  const exports = join(dir, 'exports')
  const plans = join(dir, 'plans')
  const nudges = join(dir, 'nudges')
  const snapshot = {
    id: 'snap_1',
    repoPath: '/source/queue',
    commit: 'a'.repeat(40),
    pinnedAt: '2026-10-27T00:00:00.000Z',
    fileCount: 1,
  }
  const evidence = {
    id: 'evidence_1',
    subject: { kind: 'claim' as const, claimId: 'claim_1' },
    target: { kind: 'artifact' as const, artifactId: 'artifact_1' },
    trust: 'repository_observed' as const,
  }
  const event = (seq: number, payload: AnyEvent['payload']): AnyEvent =>
    ({
      eventId: `evt_${seq}`,
      sessionId: 'repo',
      seq,
      occurredAt: '2026-10-27T00:00:00.000Z',
      schemaVersion: EVENT_SCHEMA_VERSION,
      kind: 'state_change',
      payload,
    }) as AnyEvent
  try {
    for (const path of [events, exports, plans, nudges]) await mkdir(path)
    const store = new JsonlEventStore(events, 'owner')
    await store.append(
      event(0, {
        change: 'snapshot_pinned',
        snapshot,
        artifacts: [{ id: 'artifact_1', snapshotId: 'snap_1', kind: 'file', path: 'src/queue.ts' }],
        evidence: [evidence],
      }),
    )
    await store.append(
      event(1, {
        change: 'snapshot_deleted',
        tombstone: {
          snapshotId: 'snap_1',
          commit: snapshot.commit,
          contentHash: 'hash',
          artifactCount: 1,
          reason: 'candidate_requested',
          deletedAt: '2026-10-28T00:00:00.000Z',
        },
      }),
    )
    const schedule = '{"work":[{"dueAt":"2026-11-04T00:00:00.000Z"}],"retrievals":[]}\n'
    await writeFile(join(plans, 'owner.json'), schedule)
    const backup = join(dir, 'backup')
    await backupJsonl(events, exports, backup, { plans, nudges })
    const restored = join(dir, 'restored')
    await restoreJsonl(backup, restored)
    const restoredLog = await new JsonlEventStore(join(restored, 'events'), 'owner').read('repo')
    expect(restoredLog).toEqual(await store.read('repo'))
    expect(citationAvailability(evidence, replay(restoredLog))).toBe('snapshot_deleted')
    expect(await readFile(join(restored, 'plans/owner.json'), 'utf8')).toBe(schedule)
    expect(await readFile(join(plans, 'owner.json'), 'utf8')).toBe(schedule)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('v4 backup restores configured source files alongside settings without leaking credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-sources-backup-'))
  const events = join(dir, 'events')
  const exports = join(dir, 'exports')
  const plans = join(dir, 'plans')
  const nudges = join(dir, 'nudges')
  const benchmarks = join(dir, 'benchmarks')
  const sources = join(dir, 'sources')
  try {
    for (const path of [events, exports, plans, nudges, benchmarks, sources]) await mkdir(path)
    await writeFile(join(events, 'owner.jsonl'), '{"event":1}\n')
    await writeFile(join(sources, 'main.ts'), 'console.log("hello world")\n')
    const backup = join(dir, 'backup')
    const fileCount = await backupJsonl(
      events,
      exports,
      backup,
      { plans, nudges, benchmarks, sources },
      {
        LEVELHEAD_STORE: 'jsonl',
        LEVELHEAD_EVENT_DIR: events,
        LEVELHEAD_SOURCE_DIR: sources,
        DATABASE_URL: 'postgres://user:supersecret@127.0.0.1/db',
        MODEL_PROVIDER_API_KEY: 'sk-secret-key-12345',
      },
    )
    expect(fileCount).toBe(2)
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as {
      version: number
      settings: Record<string, string>
      files: Array<{ path: string }>
    }
    expect(manifest.version).toBe(4)
    expect(manifest.files.map((file) => file.path).sort()).toEqual([
      'events/owner.jsonl',
      'sources/main.ts',
    ])
    expect(manifest.settings).toEqual({
      LEVELHEAD_STORE: 'jsonl',
      LEVELHEAD_EVENT_DIR: events,
      LEVELHEAD_SOURCE_DIR: sources,
    })
    expect(JSON.stringify(manifest)).not.toContain('supersecret')
    expect(JSON.stringify(manifest)).not.toContain('sk-secret-key-12345')

    const restored = join(dir, 'restored')
    expect(await restoreJsonl(backup, restored)).toBe(2)
    expect(await readFile(join(restored, 'sources/main.ts'), 'utf8')).toBe(
      'console.log("hello world")\n',
    )
    expect(JSON.parse(await readFile(join(restored, 'recovery-settings.json'), 'utf8'))).toEqual(
      manifest.settings,
    )
    expect((await readdir(restored)).sort()).toEqual([
      'benchmarks',
      'events',
      'exports',
      'nudges',
      'plans',
      'recovery-settings.json',
      'sources',
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
