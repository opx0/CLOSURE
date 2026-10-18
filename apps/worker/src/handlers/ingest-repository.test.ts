import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pinnedSnapshots, silentLogger } from '@levelhead/core'
import type { JobRecord, Snapshot } from '@levelhead/contracts'
import { FixedClock, MemoryEventStore, SeqIds } from '../../../cli/src/testing/fakes.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { loadWorkerConfig } from '../config.ts'
import { ingestRepository } from './ingest-repository.ts'
import type { HandlerContext } from './context.ts'

test('ingestion retry reuses its committed checkpoint after HEAD moves and cannot resurrect a tombstone', async () => {
  const dir = await mkdtemp('/tmp/opencode/enm62-ingest-')
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  try {
    git('init', '-q', '-b', 'main')
    await writeFile(join(dir, 'queue.ts'), 'export function lease() { return 30 }\n')
    git('add', '.')
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@invalid.local',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'first',
    )
    const commit = git('rev-parse', 'HEAD')
    const store = new MemoryEventStore()
    const pins: Snapshot[] = []
    let failIndex = true
    let deleted = false
    const retrieval = {
      async recordSnapshot(_owner: string, snapshot: Snapshot) {
        if (deleted) throw new Error('retrieval snapshot conflict or tombstone')
        pins.push(snapshot)
      },
      async index() {
        if (failIndex) throw new Error('scripted index failure')
      },
    }
    // Scripted lifecycle seam, not a PostgreSQL or real-model result.
    const context = {
      config: loadWorkerConfig({ DATABASE_URL: 'postgres://unused.invalid/test' }),
      storeFor: () => store,
      retrieval,
      logger: silentLogger,
      clock: new FixedClock(),
      ids: new SeqIds(),
    } as unknown as HandlerContext
    const job = {
      id: 'job_retry',
      ownerId: 'owner_retry',
      payload: { kind: 'ingest_repository', repoPath: dir, ref: 'HEAD', sessionId: REPO_SESSION },
    } as JobRecord
    await expect(ingestRepository(job, context)).rejects.toThrow('scripted index failure')
    expect(pinnedSnapshots(await store.read(REPO_SESSION))).toHaveLength(0)
    const checkpoint = pinnedSnapshots(await store.read('ingest-job_retry'))[0]!
    expect(checkpoint.snapshot.commit).toBe(commit)
    await writeFile(join(dir, 'queue.ts'), 'export function lease() { return 90 }\n')
    git('add', '.')
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@invalid.local',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'second',
    )
    failIndex = false
    await ingestRepository(job, context)
    await ingestRepository(job, context)
    expect(
      pins.every(
        (snapshot) => snapshot.id === checkpoint.snapshot.id && snapshot.commit === commit,
      ),
    ).toBe(true)
    expect(pinnedSnapshots(await store.read(REPO_SESSION))).toHaveLength(1)
    deleted = true
    await expect(ingestRepository(job, context)).rejects.toThrow('tombstone')
    expect(pinnedSnapshots(await store.read(REPO_SESSION))).toHaveLength(1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
