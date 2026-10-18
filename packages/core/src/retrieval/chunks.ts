import { createHash } from 'node:crypto'
import type { Artifact } from '@levelhead/contracts'
import type { IndexedArtifact, RetrievalChunk } from '../ports/retrieval.ts'

export interface RetrievalDocument extends RetrievalChunk {
  artifact: Artifact
  text: string
  tokenCount: number
}

export class InvalidRetrievalSourceError extends Error {
  override name = 'InvalidRetrievalSourceError'

  constructor(reason: string) {
    super(`InvalidRetrievalSource: ${reason}`)
  }
}

export class RetrievalBudgetError extends Error {
  override name = 'RetrievalBudgetError'

  constructor(reason: string) {
    super(`RetrievalBudget: ${reason}`)
  }
}

export class OversizedSourceLineError extends RetrievalBudgetError {
  override name = 'OversizedSourceLineError'

  constructor(path: string, line: number) {
    super(`OversizedSourceLine: ${path}:${line}; whole-line citation exceeds budget`)
  }
}

// Provisional byte-fallback upper bound: one token per UTF8 byte plus 16 framing tokens.
// No chars/4 estimate or tokenizer claim. Callers must reserve the encoding profile's prefix
// and any additional model-specific framing before passing maxTokens to chunkArtifact.
export function conservativeTokenCount(text: string): number {
  return Buffer.byteLength(text, 'utf8') + 16
}

export function sourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function integerBound(value: number, name: string, minimum = 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`)
  }
}

// Keep terminators attached to their source line, including CRLF. A trailing LF does not
// invent an extra line, except when an explicit artifact range identifies that empty line.
export function artifactLines(entry: IndexedArtifact): { lines: string[]; startLine: number } {
  const { artifact, text } = entry
  const { startLine, endLine } = artifact
  if ((startLine === undefined) !== (endLine === undefined)) {
    throw new InvalidRetrievalSourceError('artifact requires both line bounds')
  }
  const lines: string[] = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (startLine !== undefined && endLine !== undefined) {
    if (
      !Number.isSafeInteger(startLine) ||
      startLine < 1 ||
      !Number.isSafeInteger(endLine) ||
      endLine < startLine
    ) {
      throw new InvalidRetrievalSourceError('malformed artifact range')
    }
    const expected = endLine - startLine + 1
    if ((text.endsWith('\n') || text === '') && lines.length + 1 === expected) lines.push('')
    if (lines.length !== expected)
      throw new InvalidRetrievalSourceError('artifact range does not match exact source lines')
  }
  return { lines, startLine: startLine ?? 1 }
}

export function chunkArtifact(
  entry: IndexedArtifact,
  options: { maxTokens: number; overlapTokens?: number; version?: string },
): RetrievalDocument[] {
  const { maxTokens, overlapTokens = 0, version = 'whole-lines-utf8-v1' } = options
  integerBound(maxTokens, 'maxTokens')
  integerBound(overlapTokens, 'overlapTokens', 0)
  if (overlapTokens >= maxTokens || version.length === 0)
    throw new RangeError('invalid overlap or chunk version')
  const { lines, startLine } = artifactLines(entry)
  const bytes = lines.map((line) => Buffer.byteLength(line, 'utf8'))
  for (let index = 0; index < lines.length; index++) {
    if (bytes[index]! + 16 > maxTokens)
      throw new OversizedSourceLineError(entry.artifact.path, startLine + index)
  }
  const documents: RetrievalDocument[] = []
  let start = 0
  while (start < lines.length) {
    let end = start
    let cost = 16
    while (end < lines.length && cost + bytes[end]! <= maxTokens) cost += bytes[end++]!
    const text = lines.slice(start, end).join('')
    // The source digest verifies exact bytes; the stable id additionally binds location and
    // chunk version. Neither digest includes random artifact or owner/snapshot identifiers.
    const contentHash = sourceHash(text)
    const absoluteStart = startLine + start
    const absoluteEnd = startLine + end - 1
    documents.push({
      id: sourceHash(
        JSON.stringify([
          contentHash,
          entry.artifact.path,
          entry.artifact.symbol ?? null,
          absoluteStart,
          absoluteEnd,
          version,
        ]),
      ),
      artifact: entry.artifact,
      startLine: absoluteStart,
      endLine: absoluteEnd,
      contentHash,
      text,
      tokenCount: cost,
    })
    if (end === lines.length) break
    let next = end
    let overlap = 0
    while (
      next > start + 1 &&
      overlap + bytes[next - 1]! <= overlapTokens &&
      16 + overlap + bytes[next - 1]! + bytes[end]! <= maxTokens
    ) {
      overlap += bytes[--next]!
    }
    start = next
  }
  return documents
}
