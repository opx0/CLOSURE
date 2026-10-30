import { execFile } from 'node:child_process'
import type { Buffer } from 'node:buffer'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Artifact, Snapshot } from '@levelhead/contracts'
import {
  extractSymbols,
  type Clock,
  type IdSource,
  type PinnedRepository,
  type RepositoryPort,
} from '@levelhead/core'
import { SystemClock } from '../runtime.ts'

// Snapshots are read via `rev-parse`/`ls-tree`/`show` at the pinned commit, never `checkout` — so
// uncommitted edits can't leak into a snapshot and the untrusted repo's own config/hooks never run.
const READ_ONLY_GIT_FLAGS: readonly string[] = [
  '--no-pager',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
]

export interface GitRepositoryLimits {
  maxFiles: number
  maxTotalBytes: number
  maxFileBytes: number
  // STACK §18: a repository that nests deeper than this is generated, vendored, or hostile — and
  // in every one of those cases it is not the candidate's own work.
  maxDepth: number
  timeoutMs: number
}

// Sized for a personal project's repo, not a guess at the largest repository out there.
export const DEFAULT_LIMITS: GitRepositoryLimits = {
  maxFiles: 400,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFileBytes: 256 * 1024,
  maxDepth: 12,
  timeoutMs: 15_000,
}

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.sql',
  '.sh',
  '.yml',
  '.yaml',
  '.toml',
])

// Vendored/generated content isn't the candidate's own work, so it's excluded from snapshots.
const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'third_party',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'generated',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
])

// Defense in depth over the extension allowlist — a secret read into a snapshot can't be unread.
const SECRET_LOOKING = /^(?:\.env|id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx|keystore)$/

const GENERATED_FILE = /(?:\.min\.js|\.gen\.ts|[.-]lock\.(?:json|yaml|yml)|\.lock)$/

function isSourcePath(path: string, maxDepth: number): boolean {
  const segments = path.split('/')
  if (segments.length > maxDepth) return false
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false
  const name = segments[segments.length - 1] ?? ''
  if (SECRET_LOOKING.test(name) || GENERATED_FILE.test(name)) return false
  const at = name.lastIndexOf('.')
  return at > 0 && SOURCE_EXTENSIONS.has(name.slice(at).toLowerCase())
}

interface GitResult {
  ok: boolean
  stdout: Buffer
  message: string
}

interface TreeEntry {
  path: string
  size: number
}

interface PinnedAt {
  repoPath: string
  commit: string
}

export interface GitRepositoryDeps {
  ids: IdSource
  // Only `pinnedAt` needs it; pinning is a wall-clock act, so a real clock is a fine default.
  clock?: Clock
  limits?: Partial<GitRepositoryLimits>
  sourceRelocation?: { from: string; to: string }
}

export function sourceRelocationFromEnv(
  env: Record<string, string | undefined>,
): { from: string; to: string } | undefined {
  const from = env.LEVELHEAD_RESTORE_SOURCE_FROM
  const to = env.LEVELHEAD_RESTORE_SOURCE_TO
  if (from === undefined && to === undefined) return undefined
  if (!from || !to || !isAbsolute(from) || !isAbsolute(to))
    throw new Error(
      'Source recovery requires both absolute LEVELHEAD_RESTORE_SOURCE_FROM and LEVELHEAD_RESTORE_SOURCE_TO paths',
    )
  return { from, to }
}

export class GitRepository implements RepositoryPort {
  readonly #ids: IdSource
  readonly #clock: Clock
  readonly #limits: GitRepositoryLimits
  readonly #sourceRelocation: { from: string; to: string } | undefined
  // Keyed by snapshot id, not repo path — the path isn't the citation and the snapshot is deletable.
  readonly #pinned = new Map<string, PinnedAt>()

  constructor(deps: GitRepositoryDeps) {
    this.#ids = deps.ids
    this.#clock = deps.clock ?? new SystemClock()
    this.#limits = { ...DEFAULT_LIMITS, ...deps.limits }
    if (
      deps.sourceRelocation &&
      (!isAbsolute(deps.sourceRelocation.from) || !isAbsolute(deps.sourceRelocation.to))
    )
      throw new Error('Source relocation requires absolute paths')
    this.#sourceRelocation = deps.sourceRelocation
  }

  // Needed because replay reconstructs state from events without ever calling `pin`.
  register(snapshot: Snapshot): void {
    this.#pinned.delete(snapshot.id)
    let repoPath = snapshot.repoPath
    if (this.#sourceRelocation) {
      const from = resolve(this.#sourceRelocation.from)
      const path = resolve(repoPath)
      const subpath = relative(from, path)
      // Fail closed: in recovery mode never read an original repository outside the restored root.
      if (subpath === '..' || subpath.startsWith(`..${sep}`) || isAbsolute(subpath)) return
      repoPath = resolve(this.#sourceRelocation.to, subpath)
    }
    this.#pinned.set(snapshot.id, { repoPath, commit: snapshot.commit })
  }

  async pin(repoPath: string, ref: string): Promise<PinnedRepository> {
    const root = resolve(repoPath)
    // A ref starting with `-` could be parsed as a git flag; refuse before it reaches rev-parse.
    if (ref.startsWith('-')) throw new Error(`${JSON.stringify(ref)} is not a usable revision`)

    // `^{commit}` peels a tag/branch to the commit it names, so the pin doesn't drift as it moves.
    const resolved = await this.#git(root, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${ref}^{commit}`,
    ])
    if (!resolved.ok) throw new Error(`cannot pin ${root} at ${ref}: ${resolved.message}`)
    const commit = resolved.stdout.toString('utf8').trim()
    if (!/^[0-9a-f]{40,64}$/.test(commit)) {
      throw new Error(`${ref} in ${root} did not resolve to a commit sha`)
    }

    const snapshotId = this.#ids.next('snapshot')
    const artifacts: Artifact[] = []
    let fileCount = 0
    let bytes = 0

    for (const entry of await this.#listTree(root, commit)) {
      if (fileCount >= this.#limits.maxFiles) break
      if (!isSourcePath(entry.path, this.#limits.maxDepth)) continue
      if (entry.size > this.#limits.maxFileBytes) continue
      if (bytes + entry.size > this.#limits.maxTotalBytes) continue

      const shown = await this.#git(root, ['show', `${commit}:${entry.path}`])
      if (!shown.ok) continue
      // A NUL byte means the extension lied about the content type; nothing citable is in there.
      if (shown.stdout.includes(0)) continue

      bytes += shown.stdout.byteLength
      fileCount += 1
      const source = shown.stdout.toString('utf8')
      artifacts.push({ id: this.#ids.next('artifact'), snapshotId, kind: 'file', path: entry.path })
      for (const located of extractSymbols(entry.path, source)) {
        // ArtifactKind has no `class`; classes and structs are recorded as `function` too.
        artifacts.push({
          id: this.#ids.next('artifact'),
          snapshotId,
          kind: 'function',
          path: entry.path,
          symbol: located.symbol,
          startLine: located.startLine,
          endLine: located.endLine,
        })
      }
    }

    // Count of what was actually ingested, not what the tree held — must not overstate coverage.
    const snapshot: Snapshot = {
      id: snapshotId,
      repoPath: root,
      commit,
      pinnedAt: this.#clock.now(),
      fileCount,
    }
    this.#pinned.set(snapshotId, { repoPath: root, commit })
    return { snapshot, artifacts }
  }

  // Null, never a throw — missing snapshot/repo/commit/path is an ordinary answer, not a failure.
  async read(artifact: Artifact): Promise<string | null> {
    const pinned = this.#pinned.get(artifact.snapshotId)
    if (pinned === undefined) return null
    try {
      const shown = await this.#git(pinned.repoPath, ['show', `${pinned.commit}:${artifact.path}`])
      if (!shown.ok) return null
      const text = shown.stdout.toString('utf8')
      const { startLine, endLine } = artifact
      if (startLine === undefined || endLine === undefined) return text
      return text
        .split('\n')
        .slice(startLine - 1, endLine)
        .join('\n')
    } catch {
      return null
    }
  }

  async #listTree(root: string, commit: string): Promise<TreeEntry[]> {
    // `-z` for NUL-safe paths; `--long` to get size up front, before reading anything over the cap.
    const listed = await this.#git(root, ['ls-tree', '-r', '--long', '-z', commit])
    if (!listed.ok) throw new Error(`cannot list ${commit} in ${root}: ${listed.message}`)

    const entries: TreeEntry[] = []
    for (const record of listed.stdout.toString('utf8').split('\0')) {
      const tab = record.indexOf('\t')
      if (tab === -1) continue
      const [, kind, , size] = record.slice(0, tab).trim().split(/\s+/)
      // Submodules are `commit` entries with no size and no content in this repository.
      if (kind !== 'blob') continue
      entries.push({ path: record.slice(tab + 1), size: Number(size) })
    }
    // Tree order is git's, not the ingest order Levelhead wants to be able to reproduce.
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }

  #git(repoPath: string, args: readonly string[]): Promise<GitResult> {
    return new Promise((settle) => {
      execFile(
        'git',
        [...READ_ONLY_GIT_FLAGS, '-C', repoPath, ...args],
        {
          encoding: 'buffer',
          maxBuffer: this.#limits.maxTotalBytes,
          timeout: this.#limits.timeoutMs,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        },
        (error, stdout, stderr) => {
          const message = stderr.toString('utf8').trim()
          settle(
            error === null
              ? { ok: true, stdout, message: '' }
              : { ok: false, stdout, message: message === '' ? error.message : message },
          )
        },
      )
    })
  }
}
