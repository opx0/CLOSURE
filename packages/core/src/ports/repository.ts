import type { Artifact, Snapshot } from '@closer/contracts'

// §4.8/§7: CLOSER parses a repository, never executes it — no run/install/build verb here is the design, not a gap.
export interface PinnedRepository {
  snapshot: Snapshot
  artifacts: Artifact[]
}

export interface RepositoryPort {
  // Resolves `ref` to the commit it names — "the main branch" isn't a citable thing a week later.
  pin(repoPath: string, ref: string): Promise<PinnedRepository>
  // Null, not a throw, when the snapshot is gone — deletion is a promise CLOSER makes (§7).
  read(artifact: Artifact): Promise<string | null>
}
