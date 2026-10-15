import { SessionLog, linkSnapshotToClaims, replay } from '@levelhead/core'
import { openStore } from '../store.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { GitRepository } from '../repo/git-repository.ts'
import { loadCliConfig } from '../config.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'

// Snapshots outlive any one interview, so they get their own log, same as the claim set.
export const REPO_SESSION = 'repo'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

export async function repo(argv: readonly string[]): Promise<number> {
  const path = argv.find((arg) => !arg.startsWith('--'))
  const config = loadCliConfig()
  const { store } = openStore(config)

  if (path === undefined) {
    const view = replay(await store.read(REPO_SESSION))
    if (view.snapshot === null) {
      line('no repository pinned — run: levelhead repo <path> [--ref <commit|branch|tag>]')
      return 1
    }
    heading('pinned repository')
    line(`  ${view.snapshot.repoPath}`)
    dim(`  commit ${view.snapshot.commit}`)
    dim(`  ${view.snapshot.fileCount} files · ${view.artifacts.size} artifacts`)
    dim(`  ${view.evidence.size} claim→artifact links`)
    return 0
  }

  const clock = new SystemClock()
  const ids = new RandomIds()
  const repository = new GitRepository({ ids })
  const pinned = await repository.pin(path, flag(argv, 'ref') ?? 'HEAD')

  // Repository evidence determines what deserves examination — it never proves authorship.
  const claimSet = replay(await store.read(CLAIM_SET_SESSION))
  const confirmed = [...claimSet.claims.values()].filter((claim) =>
    claimSet.confirmedClaimIds.has(claim.id),
  )
  const evidence = linkSnapshotToClaims(pinned.artifacts, confirmed, ids)

  const log = await SessionLog.open({ store, clock, ids }, REPO_SESSION)
  await log.append('state_change', {
    change: 'snapshot_pinned',
    snapshot: pinned.snapshot,
    artifacts: pinned.artifacts,
    evidence,
  })

  heading('pinned')
  line(`  ${pinned.snapshot.repoPath} at ${pinned.snapshot.commit.slice(0, 12)}`)
  dim(
    `  ${pinned.snapshot.fileCount} files · ${pinned.artifacts.length} artifacts · ${evidence.length} claim links`,
  )
  dim('  parsed, never executed. Evidence shows what deserves examination, not who wrote it.')
  dim('  now try: levelhead session --rounds code_walkthrough')
  return 0
}
