import { expect, test } from 'bun:test'
import { loadCliConfig } from './config.ts'
import { indexRepository, repositoryStrategy, retrievalOptions } from './repository-search.ts'

test('repository search remains opt-in and invalid explicit modes fail', () => {
  expect(loadCliConfig({}).repositorySearch).toBeUndefined()
  for (const mode of ['lexical', 'dense', 'hybrid'] as const)
    expect(repositoryStrategy(mode)).toBe(mode)
  expect(() => repositoryStrategy('auto')).toThrow('must be')
  expect(() => loadCliConfig({ LEVELHEAD_REPOSITORY_SEARCH: 'invalid' })).toThrow('must be')
})

test('embedding configuration is independent, complete, pinned and local-only', () => {
  expect(retrievalOptions({ MODEL_ID: 'generation-only' }).embedding).toBeUndefined()
  expect(() => retrievalOptions({ LEVELHEAD_EMBEDDING_MODEL: 'all-minilm:22m' })).toThrow(
    'needs model',
  )
  expect(() =>
    retrievalOptions({
      LEVELHEAD_EMBEDDING_MODEL: 'all-minilm:22m',
      LEVELHEAD_EMBEDDING_REVISION: `sha256:${'1'.repeat(64)}`,
      LEVELHEAD_EMBEDDING_DIMENSIONS: '384',
      LEVELHEAD_EMBEDDING_BASE_URL: 'https://hosted.invalid',
    }),
  ).toThrow()
  const options = retrievalOptions({
    LEVELHEAD_EMBEDDING_MODEL: 'all-minilm:22m',
    LEVELHEAD_EMBEDDING_REVISION: `sha256:${'1'.repeat(64)}`,
    LEVELHEAD_EMBEDDING_DIMENSIONS: '384',
  })
  expect(options.embedding?.profile.dimensions).toBe(384)
  expect(options.embedding?.profile.maxInputTokens).toBe(256)
  expect(options.chunkMaxTokens).toBe(192)
})

test('index publication refuses partial bodies and preserves snapshot identity on retry', async () => {
  const snapshot = {
    id: 'snap_retry',
    repoPath: '/project',
    commit: 'pinned',
    pinnedAt: '2026-10-01T00:00:00.000Z',
    fileCount: 1,
  }
  const artifact = {
    id: 'artifact_retry',
    snapshotId: snapshot.id,
    kind: 'file' as const,
    path: 'queue.ts',
  }
  const calls: string[] = []
  const retrieval = {
    async recordSnapshot(owner: string, pin: typeof snapshot, hash: string) {
      calls.push(`${owner}:${pin.id}:${hash}`)
    },
    async index(owner: string, id: string) {
      calls.push(`${owner}:${id}`)
    },
  }
  await expect(
    indexRepository(retrieval, 'owner', snapshot, [{ artifact, text: '' }]),
  ).rejects.toThrow('all readable')
  expect(calls).toHaveLength(0)
  for (let retry = 0; retry < 2; retry++)
    await indexRepository(retrieval, 'owner', snapshot, [{ artifact, text: 'lease()\n' }])
  expect(calls.slice(0, 2)).toEqual(calls.slice(2))
})
