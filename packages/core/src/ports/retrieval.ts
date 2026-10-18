import type { Artifact, OwnerId } from '@levelhead/contracts'

export interface IndexedArtifact {
  artifact: Artifact
  text: string
}

export type RetrievalStrategy = 'lexical' | 'dense' | 'hybrid'

export interface RetrievalSearchOptions {
  strategy?: RetrievalStrategy
}

export interface RetrievalChunk {
  id: string
  // 1-based, inclusive, exact source lines rather than a generated summary.
  startLine: number
  endLine: number
  contentHash: string
}

export interface RetrievalHit {
  artifact: Artifact
  rank: number
  excerpt: string
  chunk?: RetrievalChunk
}

export interface RepositorySourceReference {
  artifactId: Artifact['id']
  snapshotId: Artifact['snapshotId']
  commit: string
  path: Artifact['path']
  startLine: number
  endLine: number
  contentHash: string
}

// Ephemeral, untrusted source bytes: never copy this object into immutable events.
export interface RepositorySource extends RepositorySourceReference {
  text: string
}

// Metadata only. Source order is rank order; no query, excerpt or source text is persisted.
export interface RepositorySearchTrace {
  version: string
  queryHash: string
  strategy: RetrievalStrategy
  embeddingProfileId?: string
  sources: readonly RepositorySourceReference[]
  contextHash: string
  retrievedCount: number
  sourceCount: number
  // Counted with the declared tokenizer, or an explicitly versioned conservative bound.
  tokenCount: number
}

export interface RepositoryContext {
  sources: readonly RepositorySource[]
  trace: RepositorySearchTrace
}

export interface RetrievalPort {
  index(ownerId: OwnerId, snapshotId: string, entries: readonly IndexedArtifact[]): Promise<void>
  // Omitted strategy is lexical. Explicit dense/hybrid requests fail if unavailable, never fall back.
  search(
    ownerId: OwnerId,
    snapshotId: string,
    query: string,
    limit: number,
    options?: RetrievalSearchOptions,
  ): Promise<RetrievalHit[]>
  forget(ownerId: OwnerId, snapshotId: string): Promise<void>
  // Revalidate before using source bytes; false includes a deleted or unpublished snapshot.
  isLive?(ownerId: OwnerId, snapshotId: string): Promise<boolean>
}
