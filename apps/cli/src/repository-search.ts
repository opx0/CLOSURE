import { createHash } from 'node:crypto'
import type { OwnerId, Snapshot } from '@levelhead/contracts'
import type { IndexedArtifact, RetrievalStrategy } from '@levelhead/core'
import type { PostgresRetrieval } from '@levelhead/db'
import { LocalEmbeddingAdapter } from './adapters/embedding-local.ts'

export function repositoryStrategy(value: string | undefined): RetrievalStrategy | undefined {
  if (value === undefined) return undefined
  if (value === 'lexical' || value === 'dense' || value === 'hybrid') return value
  throw new Error('repositorySearch must be lexical, dense or hybrid')
}

// Independent of generation configuration. No hosted endpoint or embedding fallback.
export function retrievalOptions(env: Record<string, string | undefined>) {
  const model = env.LEVELHEAD_EMBEDDING_MODEL
  const revision = env.LEVELHEAD_EMBEDDING_REVISION
  const dimensions = env.LEVELHEAD_EMBEDDING_DIMENSIONS
  const configured = [model, revision, dimensions].some((value) => value !== undefined)
  if (configured && (!model || !revision || !dimensions)) {
    throw new Error('embedding needs model, revision and dimensions')
  }
  const embedding = configured
    ? new LocalEmbeddingAdapter({
        baseUrl: env.LEVELHEAD_EMBEDDING_BASE_URL ?? 'http://127.0.0.1:11434',
        model: model!,
        revision: revision!,
        dimensions: Number(dimensions),
        maxInputTokens: Number(env.LEVELHEAD_EMBEDDING_MAX_INPUT_TOKENS ?? 256),
      })
    : undefined
  return {
    ...(embedding === undefined ? {} : { embedding }),
    // Leave room for the embedding contract's prefixes and special-token reserve.
    chunkMaxTokens: Number(env.LEVELHEAD_CHUNK_MAX_TOKENS ?? 192),
    chunkOverlapTokens: Number(env.LEVELHEAD_CHUNK_OVERLAP_TOKENS ?? 32),
  }
}

export async function indexRepository(
  retrieval: Pick<PostgresRetrieval, 'recordSnapshot' | 'index'>,
  ownerId: OwnerId,
  snapshot: Snapshot,
  entries: readonly IndexedArtifact[],
): Promise<void> {
  if (entries.length === 0 || entries.some((entry) => entry.text === '')) {
    throw new Error('repository indexing requires all readable artifact bodies')
  }
  const hash = createHash('sha256')
    .update(
      entries
        .map(({ artifact, text }) => `${artifact.path}:${artifact.symbol ?? ''}:${text}`)
        .sort()
        .join('\n'),
    )
    .digest('hex')
  await retrieval.recordSnapshot(ownerId, snapshot, hash)
  await retrieval.index(ownerId, snapshot.id, entries)
}
