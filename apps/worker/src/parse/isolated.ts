import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Artifact, Snapshot } from '@levelhead/contracts'

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url))

export interface IngestLimits {
  maxFiles: number
  maxTotalBytes: number
  maxFileBytes: number
  maxDepth: number
  timeoutMs: number
  heapMb: number
}

export interface IngestResult {
  snapshot: Snapshot
  artifacts: Artifact[]
  bodies: Record<string, string>
}

export class IngestFailed extends Error {
  constructor(
    readonly reason: 'timeout' | 'heap' | 'refused' | 'crashed',
    message: string,
  ) {
    super(message)
    this.name = 'IngestFailed'
  }
}

interface ChildOk {
  ok: true
  pinned: { snapshot: Snapshot; artifacts: Artifact[] }
  bodies: Record<string, string>
}

interface ChildFailed {
  ok: false
  error: string
}

// ADR-016: parsing runs in its own process under hard limits, never in the API process, and is
// killed on breach — a named failure, never a quietly truncated snapshot.
export async function ingestIsolated(
  repoPath: string,
  ref: string,
  limits: IngestLimits,
): Promise<IngestResult> {
  const runtime = process.execPath
  const child = spawn(runtime, [`--max-old-space-size=${limits.heapMb}`, CHILD], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      HOME: process.env['HOME'] ?? '/tmp',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      NODE_OPTIONS: '',
    },
  })

  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

  child.stdin.end(
    JSON.stringify({
      repoPath,
      ref,
      limits: {
        maxFiles: limits.maxFiles,
        maxTotalBytes: limits.maxTotalBytes,
        maxFileBytes: limits.maxFileBytes,
        maxDepth: limits.maxDepth,
        timeoutMs: limits.timeoutMs,
      },
    }),
  )

  const timer = setTimeout(() => child.kill('SIGKILL'), limits.timeoutMs)

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exit) => resolve(exit))
  }).finally(() => clearTimeout(timer))

  const text = Buffer.concat(stdout).toString('utf8')
  const diagnostics = Buffer.concat(stderr).toString('utf8').trim()

  if (code === null) {
    throw new IngestFailed('timeout', `parse of ${repoPath} exceeded ${limits.timeoutMs}ms`)
  }
  if (text === '') {
    const heap = /heap out of memory/i.test(diagnostics)
    throw new IngestFailed(
      heap ? 'heap' : 'crashed',
      `parse worker exited ${code} with no result${diagnostics === '' ? '' : `: ${diagnostics}`}`,
    )
  }

  const parsed = JSON.parse(text) as ChildOk | ChildFailed
  if (!parsed.ok) throw new IngestFailed('refused', parsed.error)

  return {
    snapshot: parsed.pinned.snapshot,
    artifacts: parsed.pinned.artifacts,
    bodies: parsed.bodies,
  }
}
