import { expect, test } from 'bun:test'
import type { RetrievalHit } from '../ports/retrieval.ts'
import { reciprocalRankFusion } from './ranking.ts'

function hit(id: string, rank = 1): RetrievalHit {
  return { artifact: { id, snapshotId: 's', path: `${id}.ts`, kind: 'file' }, rank, excerpt: id }
}

test('RRF deduplicates branch votes, uses ordinal rank, preserves dense chunk metadata', () => {
  const dense = {
    ...hit('b', -999),
    chunk: { id: 'chunk', startLine: 2, endLine: 3, contentHash: 'hash' },
  }
  const result = reciprocalRankFusion([hit('a', 1e9), hit('a'), hit('b')], [dense, hit('c')], 3)
  expect(result.map((entry) => entry.artifact.id)).toEqual(['b', 'a', 'c'])
  expect(result[0]?.chunk).toEqual(dense.chunk)
  expect(result[0]?.rank).toBeCloseTo(1 / 62 + 1 / 61)
})

test('ties use artifact IDs, limit and bounds are explicit', () => {
  expect(reciprocalRankFusion([hit('z')], [hit('a')], 1)[0]?.artifact.id).toBe('a')
  expect(reciprocalRankFusion([hit('a')], [], 0)).toEqual([])
  for (const limit of [-1, 1.2, Infinity])
    expect(() => reciprocalRankFusion([], [], limit)).toThrow()
  for (const constant of [-1, 0, NaN])
    expect(() => reciprocalRankFusion([], [], 2, constant)).toThrow()
})
