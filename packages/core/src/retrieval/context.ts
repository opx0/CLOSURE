import type { Artifact, Snapshot } from '@levelhead/contracts'
import type {
  RepositoryContext,
  RepositorySource,
  RepositorySourceReference,
  RetrievalChunk,
  RetrievalStrategy,
} from '../ports/retrieval.ts'
import {
  artifactLines,
  conservativeTokenCount,
  integerBound,
  InvalidRetrievalSourceError,
  RetrievalBudgetError,
  sourceHash,
} from './chunks.ts'

export function buildRepositoryContext(input: {
  snapshot: Snapshot
  candidates: readonly { artifact: Artifact; text: string; chunk?: RetrievalChunk }[]
  strategy: RetrievalStrategy
  query: string
  embeddingProfileId?: string
  maxTokens?: number
  maxSources?: number
  maxLinesPerSource?: number
}): RepositoryContext {
  const { snapshot, maxTokens = 4096, maxSources = 4, maxLinesPerSource = 120 } = input
  integerBound(maxTokens, 'maxTokens')
  integerBound(maxSources, 'maxSources')
  integerBound(maxLinesPerSource, 'maxLinesPerSource')
  if (!['lexical', 'dense', 'hybrid'].includes(input.strategy))
    throw new RangeError('invalid retrieval strategy')
  // Validate every candidate before selection: an invalid source must not hide behind a limit.
  const candidates = input.candidates.map((candidate) => {
    if (candidate.artifact.snapshotId !== snapshot.id)
      throw new InvalidRetrievalSourceError('wrong snapshot')
    const source = artifactLines(candidate)
    const chunk = candidate.chunk
    if (chunk === undefined) return { artifact: candidate.artifact, ...source }
    if (
      !Number.isSafeInteger(chunk.startLine) ||
      !Number.isSafeInteger(chunk.endLine) ||
      chunk.startLine < source.startLine ||
      chunk.endLine < chunk.startLine ||
      chunk.endLine >= source.startLine + source.lines.length
    ) {
      throw new InvalidRetrievalSourceError('chunk outside supplied exact source range')
    }
    const lines = source.lines.slice(
      chunk.startLine - source.startLine,
      chunk.endLine - source.startLine + 1,
    )
    if (sourceHash(lines.join('')) !== chunk.contentHash)
      throw new InvalidRetrievalSourceError('chunk hash does not match exact source')
    return { artifact: candidate.artifact, lines, startLine: chunk.startLine }
  })
  if (candidates[0]?.lines.length === 0)
    throw new RetrievalBudgetError('primary source has no citable whole lines')
  const sources: RepositorySource[] = []
  // Budget the serialized source payload, including escaped text, citation metadata and framing.
  // The trace is metadata, not model input; its self-referential tokenCount is not counted.
  const count = (selected: readonly RepositorySource[]) =>
    conservativeTokenCount(JSON.stringify(selected))
  if (count([]) > maxTokens)
    throw new RetrievalBudgetError('empty context framing exceeds maxTokens')
  const covered = new Map<string, { start: number; end: number }[]>()
  for (const candidate of candidates) {
    if (sources.length >= maxSources) break
    const key = JSON.stringify([snapshot.commit, candidate.artifact.path])
    const ranges = covered.get(key) ?? []
    let cursor = 0
    while (cursor < candidate.lines.length && sources.length < maxSources) {
      const line = candidate.startLine + cursor
      if (ranges.some((range) => line >= range.start && line <= range.end)) {
        cursor++
        continue
      }
      const start = cursor
      let selected: RepositorySource | undefined
      while (cursor < candidate.lines.length && cursor - start < maxLinesPerSource) {
        const absolute = candidate.startLine + cursor
        if (ranges.some((range) => absolute >= range.start && absolute <= range.end)) break
        const text = candidate.lines.slice(start, cursor + 1).join('')
        const proposed: RepositorySource = {
          artifactId: candidate.artifact.id,
          snapshotId: snapshot.id,
          commit: snapshot.commit,
          path: candidate.artifact.path,
          startLine: candidate.startLine + start,
          endLine: absolute,
          contentHash: sourceHash(text),
          text,
        }
        if (count([...sources, proposed]) > maxTokens) break
        selected = proposed
        cursor++
      }
      if (selected === undefined) {
        if (sources.length === 0)
          throw new RetrievalBudgetError('primary source has no whole line within maxTokens')
        break
      }
      sources.push(selected)
      ranges.push({ start: selected.startLine, end: selected.endLine })
      covered.set(key, ranges)
      // A per-source line cap bounds each candidate too; do not split a large primary into
      // several sources and consume every slot before considering related candidates.
      if (cursor - start === maxLinesPerSource) break
    }
  }
  const references: RepositorySourceReference[] = sources.map((source) => ({
    artifactId: source.artifactId,
    snapshotId: source.snapshotId,
    commit: source.commit,
    path: source.path,
    startLine: source.startLine,
    endLine: source.endLine,
    contentHash: source.contentHash,
  }))
  return {
    sources,
    trace: {
      version: 'repository-context-whole-lines-utf8-v1',
      queryHash: sourceHash(input.query),
      strategy: input.strategy,
      ...(input.embeddingProfileId === undefined
        ? {}
        : { embeddingProfileId: input.embeddingProfileId }),
      sources: references,
      contextHash: sourceHash(JSON.stringify(sources)),
      retrievedCount: input.candidates.length,
      sourceCount: sources.length,
      tokenCount: count(sources),
    },
  }
}
