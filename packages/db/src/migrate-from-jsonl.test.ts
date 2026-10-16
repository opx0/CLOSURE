import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EVENT_SCHEMA_VERSION, type AnyEvent } from '@levelhead/contracts'
import { AppendOnlyViolation, type EventStore } from '@levelhead/core'
import { importJsonlDirectory } from './migrate-from-jsonl.ts'
import { runMigrations } from './migrations/runner.ts'
import { PostgresEventStore } from './postgres-event-store.ts'
import { openTestDatabase } from './testing/postgres.ts'

const AT = '2026-09-09T10:00:00.000Z'

function event(sessionId: string, seq: number, reason: string): AnyEvent {
  return {
    eventId: `evt_${sessionId}_${seq}`,
    sessionId,
    seq,
    occurredAt: AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind: 'state_change',
    payload: { change: 'session_closed', reason },
  }
}

// Written against the port, not Postgres, so idempotence is tested as a property of the replay,
// not of the driver.
class MemoryEventStore implements EventStore {
  readonly #sessions = new Map<string, AnyEvent[]>()

  async append(candidate: AnyEvent): Promise<void> {
    const existing = this.#sessions.get(candidate.sessionId) ?? []
    if (existing.some((stored) => stored.seq === candidate.seq)) {
      throw new AppendOnlyViolation(candidate.sessionId, candidate.seq)
    }
    this.#sessions.set(candidate.sessionId, [...existing, candidate])
  }

  async read(sessionId: string): Promise<AnyEvent[]> {
    return [...(this.#sessions.get(sessionId) ?? [])].sort((a, b) => a.seq - b.seq)
  }

  async listSessions(): Promise<string[]> {
    return [...this.#sessions.keys()].sort()
  }
}

async function withLogDirectory(
  files: Record<string, string[]>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-jsonl-'))
  try {
    for (const [name, lines] of Object.entries(files)) {
      await writeFile(join(dir, name), lines.map((line) => `${line}\n`).join(''), 'utf8')
    }
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function line(source: AnyEvent): string {
  return JSON.stringify(source)
}

const twoSessions = {
  'ses_1.jsonl': [line(event('ses_1', 0, 'a')), line(event('ses_1', 1, 'b'))],
  'ses_2.jsonl': [line(event('ses_2', 0, 'c'))],
}

test('replays every file into the store and reports per-session counts', async () => {
  await withLogDirectory(twoSessions, async (dir) => {
    const store = new MemoryEventStore()
    const report = await importJsonlDirectory(store, dir)

    expect(report.imported).toBe(3)
    expect(report.skipped).toBe(0)
    expect(report.sessions.map(({ sessionId, imported }) => ({ sessionId, imported }))).toEqual([
      { sessionId: 'ses_1', imported: 2 },
      { sessionId: 'ses_2', imported: 1 },
    ])
    expect(await store.read('ses_1')).toEqual([event('ses_1', 0, 'a'), event('ses_1', 1, 'b')])
  })
})

test('running it twice imports nothing the second time and duplicates nothing', async () => {
  await withLogDirectory(twoSessions, async (dir) => {
    const store = new MemoryEventStore()
    await importJsonlDirectory(store, dir)
    const second = await importJsonlDirectory(store, dir)

    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(3)
    expect(await store.read('ses_1')).toHaveLength(2)
    expect(await store.read('ses_2')).toHaveLength(1)
  })
})

test('a partially migrated session resumes at the first missing seq', async () => {
  await withLogDirectory(twoSessions, async (dir) => {
    const store = new MemoryEventStore()
    await store.append(event('ses_1', 0, 'a'))

    const report = await importJsonlDirectory(store, dir)
    expect(report.imported).toBe(2)
    expect(report.skipped).toBe(1)
  })
})

test('a stored event that differs from the file at the same seq is a divergence, not a skip', async () => {
  await withLogDirectory(twoSessions, async (dir) => {
    const store = new MemoryEventStore()
    await store.append({ ...event('ses_1', 0, 'a'), eventId: 'evt_elsewhere' })

    await expect(importJsonlDirectory(store, dir)).rejects.toThrow(/diverged/)
  })
})

test('a line filed under the wrong session is refused', async () => {
  await withLogDirectory({ 'ses_1.jsonl': [line(event('ses_9', 0, 'a'))] }, async (dir) => {
    await expect(importJsonlDirectory(new MemoryEventStore(), dir)).rejects.toThrow(
      /belongs to session ses_9, not ses_1/,
    )
  })
})

test('a corrupt line names the file and the line number', async () => {
  await withLogDirectory(
    { 'ses_1.jsonl': [line(event('ses_1', 0, 'a')), 'not json'] },
    async (dir) => {
      await expect(importJsonlDirectory(new MemoryEventStore(), dir)).rejects.toThrow(
        /ses_1\.jsonl:2 is not valid JSON/,
      )
    },
  )
})

test('a missing directory is nothing to migrate, not an error', async () => {
  const report = await importJsonlDirectory(
    new MemoryEventStore(),
    join(tmpdir(), 'levelhead-absent'),
  )
  expect(report).toEqual({ sessions: [], imported: 0, skipped: 0 })
})

const url = process.env['DATABASE_URL']
const database =
  url === undefined ? undefined : await openTestDatabase(url, 'levelhead_test_import')
if (database === undefined) {
  console.log(
    '[skipped] packages/db JSONL-to-Postgres integration test: DATABASE_URL is unset or unreachable',
  )
}
const integration = database === undefined ? test.skip : test

afterAll(async () => {
  await database?.close()
})

integration('replays a JSONL directory into Postgres idempotently', async () => {
  if (database === undefined) return
  await runMigrations(database.pool)
  const store = new PostgresEventStore(database.pool)

  await withLogDirectory(twoSessions, async (dir) => {
    expect((await importJsonlDirectory(store, dir)).imported).toBe(3)
    expect((await importJsonlDirectory(store, dir)).imported).toBe(0)
    expect(await store.read('ses_1')).toEqual([event('ses_1', 0, 'a'), event('ses_1', 1, 'b')])
    expect(await store.listSessions()).toEqual(['ses_1', 'ses_2'])
  })
})
