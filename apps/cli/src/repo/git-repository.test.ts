import { expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Artifact } from '@levelhead/contracts'
import type { Clock, IdSource, PinnedRepository } from '@levelhead/core'
import { GitRepository } from './git-repository.ts'

const QUEUE_TS = [
  "import type { Job } from './types.ts'",
  '',
  'const LEASE_MS = 30_000',
  '',
  'export function claimJob(worker: string): Job | null {',
  '  const job = nextJob()',
  '  if (job === null) return null',
  '  job.leasedUntil = Date.now() + LEASE_MS',
  '  return job',
  '}',
  '',
].join('\n')

const WORKER_PY = ['def retry(job):', '    return run(job)', ''].join('\n')

function run(cwd: string, args: readonly string[]): Promise<void> {
  return new Promise((settle, fail) => {
    execFile('git', args, { cwd }, (error, _stdout, stderr) => {
      if (error === null) settle()
      else fail(new Error(`git ${args.join(' ')} failed: ${stderr}`))
    })
  })
}

async function commitAll(dir: string, message: string): Promise<void> {
  await run(dir, ['add', '-A'])
  // Configured per invocation so the test needs no global git identity to exist.
  await run(dir, [
    '-c',
    'user.email=test@levelhead.invalid',
    '-c',
    'user.name=Levelhead Test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  ])
}

async function withRepo(
  files: Readonly<Record<string, string>>,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-repo-'))
  try {
    await run(dir, ['init', '-q', '-b', 'main'])
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
    await commitAll(dir, 'first')
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function deps(): { ids: IdSource; clock: Clock } {
  let n = 0
  return {
    ids: { next: (prefix) => `${prefix}_${(n += 1)}` },
    clock: { now: () => '2026-09-09T10:00:00.000Z' },
  }
}

const SOURCES: Readonly<Record<string, string>> = {
  'src/queue.ts': QUEUE_TS,
  'src/worker.py': WORKER_PY,
  'README.md': '# not source\n',
  'node_modules/dep/index.ts': 'export function vendored() {\n  return 1\n}\n',
  'assets/logo.png': 'PNG bytes',
  // Passes the extension allowlist and is still not text: the NUL check is what stops it.
  'src/compiled.ts': 'export const data = "\u0000\u0001"\n',
  '.env': 'SECRET=hunter2\n',
}

test('pins a ref to a commit sha and builds file and function artifacts', async () => {
  await withRepo(SOURCES, async (dir) => {
    const { snapshot, artifacts } = await new GitRepository(deps()).pin(dir, 'main')

    expect(snapshot.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(snapshot.pinnedAt).toBe('2026-09-09T10:00:00.000Z')
    // The two source files and only those: the README is outside the allowlist, `compiled.ts`
    // holds NUL bytes, `.env` looks like a secret, and node_modules is vendored.
    expect(snapshot.fileCount).toBe(2)
    expect(artifacts.filter((found) => found.kind === 'file').map((found) => found.path)).toEqual([
      'src/queue.ts',
      'src/worker.py',
    ])
    expect(
      artifacts.filter((found) => found.kind === 'function').map((found) => found.symbol),
    ).toEqual(['claimJob', 'retry'])
    expect(artifacts.every((found) => found.snapshotId === snapshot.id)).toBe(true)
  })
})

test('a function artifact reads back as exactly the function it cites', async () => {
  await withRepo(SOURCES, async (dir) => {
    const repository = new GitRepository(deps())
    const { artifacts } = await repository.pin(dir, 'HEAD')
    const claimJob = artifacts.find((found) => found.symbol === 'claimJob')

    expect(claimJob?.startLine).toBe(5)
    expect(claimJob?.endLine).toBe(10)
    expect(claimJob === undefined ? null : await repository.read(claimJob)).toBe(
      [
        'export function claimJob(worker: string): Job | null {',
        '  const job = nextJob()',
        '  if (job === null) return null',
        '  job.leasedUntil = Date.now() + LEASE_MS',
        '  return job',
        '}',
      ].join('\n'),
    )

    const file = artifacts.find((found) => found.kind === 'file' && found.path === 'src/queue.ts')
    expect(file === undefined ? null : await repository.read(file)).toBe(QUEUE_TS)
  })
})

// Reading the working tree instead of the object would break the pin's promise silently.
test('uncommitted working-tree edits never enter a pinned snapshot', async () => {
  await withRepo(SOURCES, async (dir) => {
    const repository = new GitRepository(deps())
    const { artifacts } = await repository.pin(dir, 'HEAD')

    await writeFile(
      join(dir, 'src/queue.ts'),
      'export function claimJob() {\n  return "edited"\n}\n',
    )
    await writeFile(join(dir, 'src/uncommitted.ts'), 'export function ghost() {\n  return 1\n}\n')

    const claimJob = artifacts.find((found) => found.symbol === 'claimJob')
    const text = claimJob === undefined ? '' : ((await repository.read(claimJob)) ?? '')
    expect(text).toContain('job.leasedUntil = Date.now() + LEASE_MS')
    expect(text).not.toContain('edited')

    const after = await repository.pin(dir, 'HEAD')
    expect(after.artifacts.map((found) => found.path)).not.toContain('src/uncommitted.ts')
  })
})

test('read returns null instead of throwing once the snapshot is gone', async () => {
  const repository = new GitRepository(deps())
  let pinned: PinnedRepository | null = null
  await withRepo(SOURCES, async (dir) => {
    pinned = await repository.pin(dir, 'HEAD')
  })

  // withRepo removed the repository directory on its way out, which is what deletion looks like.
  const claimJob = (pinned as PinnedRepository | null)?.artifacts.find(
    (found) => found.symbol === 'claimJob',
  )
  expect(claimJob).toBeDefined()
  expect(claimJob === undefined ? 'threw' : await repository.read(claimJob)).toBeNull()

  const unknown: Artifact = {
    id: 'artifact_x',
    snapshotId: 'snapshot_never',
    kind: 'file',
    path: 'src/queue.ts',
  }
  expect(await repository.read(unknown)).toBeNull()
})

test('an unresolvable ref fails loudly, because the candidate asked for that repository', async () => {
  await withRepo(SOURCES, async (dir) => {
    const repository = new GitRepository(deps())
    await expect(repository.pin(dir, 'no-such-branch')).rejects.toThrow(/cannot pin/)
    await expect(repository.pin(dir, '--upload-pack=touch')).rejects.toThrow(/not a usable/)
  })
})

test('the file cap bounds the snapshot and fileCount records what was really ingested', async () => {
  const many = Object.fromEntries(
    Array.from({ length: 6 }, (_, at) => [
      `src/mod${at}.ts`,
      `export function f${at}() {\n  return ${at}\n}\n`,
    ]),
  )
  await withRepo(many, async (dir) => {
    const repository = new GitRepository({ ...deps(), limits: { maxFiles: 2 } })
    const { snapshot, artifacts } = await repository.pin(dir, 'HEAD')

    expect(snapshot.fileCount).toBe(2)
    expect(artifacts.filter((found) => found.kind === 'file').map((found) => found.path)).toEqual([
      'src/mod0.ts',
      'src/mod1.ts',
    ])
  })
})

test('registering a snapshot from the log lets a fresh process read its artifacts', async () => {
  await withRepo(SOURCES, async (dir) => {
    const pinned = await new GitRepository(deps()).pin(dir, 'HEAD')
    // What replay does: the pin lives in a `snapshot_pinned` event, not in this process's memory.
    const reopened = new GitRepository(deps())
    const file = pinned.artifacts.find((found) => found.path === 'src/worker.py')

    expect(file === undefined ? 'missing' : await reopened.read(file)).toBeNull()
    reopened.register(pinned.snapshot)
    expect(file === undefined ? null : await reopened.read(file)).toBe(WORKER_PY)
  })
})

// STACK §18. A path that nests deeper than the cap is generated, vendored, or hostile, and in every
// one of those cases it is not the candidate's own work.
test('a path deeper than the depth limit is not ingested', async () => {
  await withRepo(
    {
      'a/b/c/d/deep.ts': 'export const deep = 1\n',
      'shallow.ts': 'export const shallow = 1\n',
    },
    async (dir) => {
      const pinned = await new GitRepository({ ...deps(), limits: { maxDepth: 2 } }).pin(
        dir,
        'HEAD',
      )

      const paths = pinned.artifacts.map((artifact) => artifact.path)
      expect(paths).toContain('shallow.ts')
      expect(paths).not.toContain('a/b/c/d/deep.ts')
    },
  )
})
