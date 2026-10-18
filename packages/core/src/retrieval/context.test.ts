import { expect, test } from 'bun:test'
import type { Artifact, Snapshot } from '@levelhead/contracts'
import { chunkArtifact, sourceHash } from './chunks.ts'
import { buildRepositoryContext } from './context.ts'

const snapshot: Snapshot = {
  id: 's',
  commit: 'commit',
  repoPath: '/repo',
  pinnedAt: '2026-01-01T00:00:00Z',
  fileCount: 1,
}
const artifact: Artifact = {
  id: 'a',
  snapshotId: 's',
  kind: 'function',
  path: 'a.ts',
  startLine: 10,
  endLine: 12,
}
const candidate = { artifact, text: 'é\r\n猫\r\nx' }
const input = {
  snapshot,
  candidates: [candidate],
  strategy: 'hybrid' as const,
  query: 'secret-query',
}

test('rehydrates exact artifact-relative chunk lines, hashes bytes and emits metadata-only trace', () => {
  const chunk = chunkArtifact(candidate, { maxTokens: 22 })[1]!
  const context = buildRepositoryContext({
    ...input,
    candidates: [{ ...candidate, chunk }],
    embeddingProfileId: 'profile',
  })
  expect(context.sources[0]).toMatchObject({
    startLine: 11,
    endLine: 12,
    text: '猫\r\nx',
    contentHash: sourceHash('猫\r\nx'),
    commit: 'commit',
  })
  expect(context.trace.sources[0]).not.toHaveProperty('text')
  expect(JSON.stringify(context.trace)).not.toContain('secret-query')
  expect(JSON.stringify(context.trace)).not.toContain('猫')
  expect(
    buildRepositoryContext({
      ...input,
      candidates: [{ ...candidate, chunk }],
      embeddingProfileId: 'profile',
    }),
  ).toEqual(context)
})

test('primary remains first; whole-line clipping and overlap dedupe retain exact citations', () => {
  const context = buildRepositoryContext({
    ...input,
    candidates: [
      candidate,
      { ...candidate, artifact: { ...artifact, id: 'duplicate' } },
      { artifact: { ...artifact, id: 'later', startLine: 12, endLine: 13 }, text: 'x\ny' },
    ],
    maxLinesPerSource: 2,
  })
  expect(
    context.sources.map((source) => [
      source.artifactId,
      source.startLine,
      source.endLine,
      source.text,
    ]),
  ).toEqual([
    ['a', 10, 11, 'é\r\n猫\r\n'],
    ['duplicate', 12, 12, 'x'],
    ['later', 13, 13, 'y'],
  ])
  expect(context.trace.tokenCount).toBeLessThanOrEqual(4096)
})

test('rejects wrong scope, malformed ranges and mismatched hashes even in later candidates', () => {
  for (const invalid of [
    { ...candidate, artifact: { ...artifact, snapshotId: 'other' } },
    { ...candidate, artifact: { ...artifact, startLine: 0 } },
    {
      ...candidate,
      chunk: { id: 'x', startLine: 9, endLine: 10, contentHash: sourceHash(candidate.text) },
    },
    { ...candidate, chunk: { id: 'x', startLine: 10, endLine: 12, contentHash: 'wrong' } },
  ])
    expect(() =>
      buildRepositoryContext({ ...input, candidates: [candidate, invalid], maxSources: 1 }),
    ).toThrow('InvalidRetrievalSource')
})

test('budgets include metadata and framing, clip only whole lines or reject primary explicitly', () => {
  const full = buildRepositoryContext(input)
  const bounded = buildRepositoryContext({ ...input, maxTokens: full.trace.tokenCount - 1 })
  expect(bounded.sources[0]?.endLine).toBeLessThan(12)
  expect(bounded.trace.tokenCount).toBeLessThanOrEqual(full.trace.tokenCount - 1)
  expect(() => buildRepositoryContext({ ...input, maxTokens: 20 })).toThrow('RetrievalBudget')
  expect(() => buildRepositoryContext({ ...input, maxSources: 0 })).toThrow()
  expect(buildRepositoryContext({ ...input, candidates: [] }).sources).toEqual([])
})

test('identical duplicate sources are omitted and oversized UTF8 primary lines fail explicitly', () => {
  const context = buildRepositoryContext({ ...input, candidates: [candidate, candidate] })
  expect(context.sources).toHaveLength(1)
  expect(context.trace.retrievedCount).toBe(2)
  const large = { artifact: { ...artifact, startLine: 10, endLine: 10 }, text: '猫'.repeat(2000) }
  expect(() => buildRepositoryContext({ ...input, candidates: [large], maxTokens: 1000 })).toThrow(
    'RetrievalBudget',
  )
})

test('an empty primary is never silently replaced by a related candidate', () => {
  expect(() =>
    buildRepositoryContext({
      ...input,
      candidates: [
        {
          artifact: { id: 'empty', snapshotId: 's', kind: 'file', path: 'empty' },
          text: '',
        },
        candidate,
      ],
    }),
  ).toThrow('RetrievalBudget')
})
