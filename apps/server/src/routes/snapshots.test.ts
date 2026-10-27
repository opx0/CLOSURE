import { expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JobRecord } from '@levelhead/contracts'
import type { EnqueueInput, JobQueuePort } from '@levelhead/core'
import { EXTRACTION, confirmedClaim, testApi } from '../testing/harness.ts'

const CLAIM_JOB = [
  'export function claimJob(worker: string, jobs: Job[]): Job | null {',
  '  const job = jobs.find((candidate) => candidate.leasedUntil < Date.now())',
  '  if (job === undefined) return null',
  '  job.worker = worker',
  '  job.leasedUntil = Date.now() + LEASE_MS',
  '  job.attempts += 1',
  '  return job',
  '}',
].join('\n')

const FILES = {
  'src/queue.ts': [
    "import type { Job } from './types.ts'",
    '',
    'const LEASE_MS = 30_000',
    '',
    CLAIM_JOB,
    '',
  ].join('\n'),
  'src/format.ts': [
    'export function formatDuration(ms: number): string {',
    '  if (ms < 1_000) return `${ms} ms`',
    '  return `${(ms / 1_000).toFixed(1)} s`',
    '}',
    '',
  ].join('\n'),
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((settle, fail) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error === null) settle(stdout.trim())
      else fail(new Error(`git ${args.join(' ')} failed: ${stderr}`))
    })
  })
}

async function withRepo(body: (dir: string, commit: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-pin-'))
  try {
    await git(dir, ['init', '-q', '-b', 'main'])
    for (const [path, content] of Object.entries(FILES)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
    await git(dir, ['add', '-A'])
    await git(dir, [
      '-c',
      'user.email=test@levelhead.invalid',
      '-c',
      'user.name=Levelhead Test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'first',
    ])
    await body(dir, await git(dir, ['rev-parse', 'HEAD']))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

interface PinnedBody {
  snapshot: {
    id: string
    repoPath: string
    commit: string
    fileCount: number
    artifactCount: number
    pinnedAt: string
    deleted: boolean
  }
}

test('with no queue, a pin is parsed in a child process and a walkthrough opens its code', async () => {
  const { app } = await testApi({
    questions: ['Walk me through claimJob. What happens when two workers call it at once?'],
    scripted: [EXTRACTION],
  })
  await confirmedClaim(app)

  await withRepo(async (dir, commit) => {
    const pinned = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })
    expect(pinned.statusCode).toBe(201)
    const { snapshot } = pinned.json() as PinnedBody
    expect(snapshot.id).toMatch(/^snapshot_[0-9a-f]{8}$/)
    expect(snapshot).toEqual({
      id: snapshot.id,
      repoPath: dir,
      commit,
      fileCount: 2,
      artifactCount: 4,
      pinnedAt: snapshot.pinnedAt,
      deleted: false,
    })

    const listed = await app.inject({ method: 'GET', url: '/snapshots' })
    expect(listed.json() as { snapshots: unknown[] }).toEqual({ snapshots: [snapshot] })

    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { rounds: ['code_walkthrough'], mode: 'coach' },
    })
    expect(started.statusCode).toBe(201)
    const turn = started.json() as {
      sessionId: string
      round?: { kind: string }
      question?: Record<string, unknown>
    }
    expect(turn.round?.kind).toBe('code_walkthrough')
    expect(turn.question?.['text']).toBe(
      'Walk me through claimJob. What happens when two workers call it at once?',
    )
    const shown = {
      path: 'src/queue.ts',
      symbol: 'claimJob',
      startLine: 5,
      endLine: 12,
      code: CLAIM_JOB,
    }
    expect(turn.question?.['artifact']).toEqual(shown)
    expect(turn.question?.['topic']).toBeUndefined()

    const events = (
      await app.inject({ method: 'GET', url: `/sessions/${turn.sessionId}/events` })
    ).json() as { kind: string; payload: { artifactId?: string } }[]
    const artifactId = events.find((event) => event.kind === 'policy_action')?.payload.artifactId
    const excerpt = `/snapshots/${snapshot.id}/artifacts/${artifactId ?? 'none'}`
    const read = await app.inject({ method: 'GET', url: excerpt })
    expect(read.statusCode).toBe(200)
    expect(read.json() as unknown).toEqual({ artifact: shown })

    const beforeReview = (await app.inject('/review')).json().citations
    expect(beforeReview.resolved).toBeGreaterThan(0)
    await app.inject({ method: 'DELETE', url: `/snapshots/${snapshot.id}` })
    const afterReview = (await app.inject('/review')).json().citations
    expect(afterReview.snapshotDeleted).toBeGreaterThan(0)
    const gone = await app.inject({ method: 'GET', url: excerpt })
    expect(gone.statusCode).toBe(404)
    expect((gone.json() as { error: string }).error).toBe('no such artifact')
  })
})

test('pinning the same commit twice lists the project once', async () => {
  const { app } = await testApi()

  await withRepo(async (dir) => {
    const first = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })
    const again = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })
    expect(again.statusCode).toBe(201)
    expect((again.json() as PinnedBody).snapshot).toEqual((first.json() as PinnedBody).snapshot)

    const listed = await app.inject({ method: 'GET', url: '/snapshots' })
    expect((listed.json() as { snapshots: unknown[] }).snapshots).toHaveLength(1)
  })
})

test('a pin links a confirmed claim only to the code that shares its words, until it is deleted', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })
  await confirmedClaim(app)

  const codeTags = async () => {
    const feedback = await app.inject({ method: 'GET', url: '/resume/feedback' })
    const { lines } = feedback.json() as {
      lines: { tags: { kind: string; artifactPaths: string[] }[] }[]
    }
    return lines
      .flatMap((line) => line.tags)
      .map(({ kind, artifactPaths }) => ({ kind, artifactPaths }))
  }

  await withRepo(async (dir) => {
    const pinned = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })
    const { snapshot } = pinned.json() as PinnedBody
    expect(await codeTags()).toEqual([{ kind: 'linked_code', artifactPaths: ['src/queue.ts'] }])

    const deleted = await app.inject({ method: 'DELETE', url: `/snapshots/${snapshot.id}` })
    expect(deleted.statusCode).toBe(200)
    expect(await codeTags()).toEqual([{ kind: 'code_not_checked', artifactPaths: [] }])

    const listed = await app.inject({ method: 'GET', url: '/snapshots' })
    expect(listed.json() as { snapshots: unknown[] }).toEqual({
      snapshots: [{ ...snapshot, deleted: true }],
    })
  })
})

test('a path that is not a git repository is refused by the parse, and nothing is pinned', async () => {
  const { app, store } = await testApi()
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-not-a-repo-'))
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })

    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: string }).error).toBe('repository not pinned: refused')
    expect(await store.read('repo')).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function recordingQueue(): { queue: JobQueuePort; enqueued: EnqueueInput[] } {
  const enqueued: EnqueueInput[] = []
  const unused = async (): Promise<never> => {
    throw new Error('not used by POST /snapshots')
  }
  const queue: JobQueuePort = {
    async enqueue(input): Promise<JobRecord> {
      enqueued.push(input)
      return {
        id: 'job_0001',
        ownerId: input.ownerId,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        state: 'queued',
        attempts: 0,
        maxAttempts: 5,
        runAfter: '2026-09-09T09:00:00.000Z',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        createdAt: '2026-09-09T09:00:00.000Z',
        updatedAt: '2026-09-09T09:00:00.000Z',
      }
    },
    claim: unused,
    succeed: unused,
    retry: unused,
    bury: unused,
    release: unused,
    list: unused,
    get: unused,
  }
  return { queue, enqueued }
}

test('with a durable queue, a pin is handed to the worker and nothing is parsed here', async () => {
  const { queue, enqueued } = recordingQueue()
  const { app, store } = await testApi({ queue })

  const response = await app.inject({
    method: 'POST',
    url: '/snapshots',
    payload: { repoPath: '/home/candidate/project', ref: 'main' },
  })

  expect(response.statusCode).toBe(202)
  expect((response.json() as { job: { id: string } }).job.id).toBe('job_0001')
  expect(enqueued.map(({ kind, payload }) => ({ kind, payload }))).toEqual([
    {
      kind: 'ingest_repository',
      payload: {
        kind: 'ingest_repository',
        repoPath: '/home/candidate/project',
        ref: 'main',
        sessionId: 'repo',
      },
    },
  ])
  expect(await store.listSessions()).toEqual([])
})

test('a showcase visitor cannot make the server read a path on its disk', async () => {
  const { app, store } = await testApi({
    config: { LEVELHEAD_API_TOKENS: 'visitor:showcase:visitor-token' },
  })

  const response = await app.inject({
    method: 'POST',
    url: '/snapshots',
    headers: { authorization: 'Bearer visitor-token' },
    payload: { repoPath: process.cwd() },
  })

  expect(response.statusCode).toBe(403)
  expect(response.json() as { error: string; detail: string }).toEqual({
    error: 'a showcase visitor cannot pin or read a repository',
    detail: 'pinning reads a path on this server’s own disk',
  })
  expect(await store.listSessions()).toEqual([])
})

// The showcase deploys with LEVELHEAD_DEMO_MODE on and no tokens at all, so a request that sends no
// Authorization header is the one a visitor can always make.
test('on a showcase instance, a request with no token cannot pin or read a path either', async () => {
  const { app, store } = await testApi({
    config: { LEVELHEAD_DEMO_MODE: true, LEVELHEAD_API_TOKENS: '' },
  })

  const pinned = await app.inject({
    method: 'POST',
    url: '/snapshots',
    payload: { repoPath: process.cwd() },
  })
  const read = await app.inject({ method: 'GET', url: '/snapshots/snapshot_1/artifacts/art_1' })

  expect([pinned.statusCode, read.statusCode]).toEqual([403, 403])
  expect(await store.listSessions()).toEqual([])
})
