import { describe, expect, test } from 'bun:test'
import type { Artifact } from '@levelhead/contracts'
import { chunkArtifact, conservativeTokenCount, sourceHash } from './chunks.ts'

const artifact: Artifact = { id: 'a', snapshotId: 's', kind: 'file', path: 'src/a.ts' }

describe('chunkArtifact', () => {
  test('preserves UTF8 and CRLF bytes, absolute lines and stable identity', () => {
    const entry = { artifact: { ...artifact, startLine: 20, endLine: 22 }, text: 'é\r\n猫\r\nx' }
    const chunks = chunkArtifact(entry, { maxTokens: 22 })
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(entry.text)
    expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
      [20, 20],
      [21, 22],
    ])
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(conservativeTokenCount(chunk.text))
      expect(chunk.tokenCount).toBeLessThanOrEqual(22)
      expect(chunk.contentHash).toBe(sourceHash(chunk.text))
    }
    expect(
      chunkArtifact(
        { ...entry, artifact: { ...entry.artifact, id: 'random', snapshotId: 'other' } },
        { maxTokens: 22 },
      ),
    ).toEqual(
      chunks.map((chunk) => ({
        ...chunk,
        artifact: { ...entry.artifact, id: 'random', snapshotId: 'other' },
      })),
    )
    expect(chunkArtifact(entry, { maxTokens: 22, version: 'next' })[0]?.id).not.toBe(chunks[0]?.id)
  })

  test('bounded whole-line overlap progresses and does not duplicate chunks', () => {
    const chunks = chunkArtifact(
      { artifact, text: 'aa\nbb\ncc\ndd\n' },
      { maxTokens: 25, overlapTokens: 6 },
    )
    expect(chunks.map((chunk) => chunk.text)).toEqual(['aa\nbb\ncc\n', 'bb\ncc\ndd\n'])
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length)
  })

  test('never silently truncates overlong lines or accepts malformed ranges/budgets', () => {
    expect(() => chunkArtifact({ artifact, text: '猫'.repeat(100) }, { maxTokens: 30 })).toThrow(
      'OversizedSourceLine',
    )
    expect(() => chunkArtifact({ artifact, text: 'x' }, { maxTokens: Number.NaN })).toThrow()
    expect(() =>
      chunkArtifact(
        { artifact: { ...artifact, startLine: 4, endLine: 3 }, text: 'x' },
        { maxTokens: 30 },
      ),
    ).toThrow()
    expect(() =>
      chunkArtifact({ artifact, text: 'x' }, { maxTokens: 30, overlapTokens: 30 }),
    ).toThrow()
    expect(chunkArtifact({ artifact, text: '' }, { maxTokens: 30 })).toEqual([])
  })

  test('covers every line of a large file without truncation and preserves location in identity', () => {
    const text = Array.from({ length: 1000 }, (_, index) => `${index}猫\r\n`).join('')
    const chunks = chunkArtifact({ artifact, text }, { maxTokens: 64 })
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text)
    expect(chunks.at(-1)?.endLine).toBe(1000)
    const original = chunkArtifact({ artifact, text: 'same' }, { maxTokens: 64 })[0]!
    for (const changed of [
      { ...artifact, path: 'other.ts' },
      { ...artifact, symbol: 'other' },
      { ...artifact, startLine: 3, endLine: 3 },
    ]) {
      expect(chunkArtifact({ artifact: changed, text: 'same' }, { maxTokens: 64 })[0]?.id).not.toBe(
        original.id,
      )
    }
  })
})
