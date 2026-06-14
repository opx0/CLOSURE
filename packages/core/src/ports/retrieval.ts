import type { Artifact, OwnerId } from '@closer/contracts'

export interface IndexedArtifact {
  artifact: Artifact
  text: string
}

export interface RetrievalHit {
  artifact: Artifact
  rank: number
  excerpt: string
}

export interface RetrievalPort {
  index(ownerId: OwnerId, snapshotId: string, entries: readonly IndexedArtifact[]): Promise<void>
  search(
    ownerId: OwnerId,
    snapshotId: string,
    query: string,
    limit: number,
  ): Promise<RetrievalHit[]>
  forget(ownerId: OwnerId, snapshotId: string): Promise<void>
}
