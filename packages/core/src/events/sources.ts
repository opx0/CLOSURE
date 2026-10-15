import { Buffer } from 'node:buffer'
import type { Span } from '@levelhead/contracts'

export type SpanResolution =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: string }

// Long enough to see an off-by-one, short enough not to paste a résumé into an error message.
function preview(text: string): string {
  return JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text)
}

// Span validity is a build failure, not a score (ticket 05 §3); offsets are BYTE offsets, not character offsets.
export function resolveSpan(span: Span, sources: ReadonlyMap<string, string>): SpanResolution {
  const text = sources.get(span.sourceId)
  if (text === undefined) return { ok: false, reason: `no source ${span.sourceId} in this session` }

  const source = Buffer.from(text, 'utf8')
  if (span.endByte < span.startByte) {
    return { ok: false, reason: `endByte ${span.endByte} precedes startByte ${span.startByte}` }
  }
  if (span.endByte > source.length) {
    return {
      ok: false,
      reason: `[${span.startByte}, ${span.endByte}) runs past the end of ${span.sourceId} (${source.length} bytes)`,
    }
  }

  const bytes = source.subarray(span.startByte, span.endByte)
  const quoted = Buffer.from(span.quoted, 'utf8')
  if (!bytes.equals(quoted)) {
    return {
      ok: false,
      reason: `[${span.startByte}, ${span.endByte}) of ${span.sourceId} is ${preview(bytes.toString('utf8'))}, not the quoted ${preview(span.quoted)}`,
    }
  }
  return { ok: true, bytes }
}

// No fuzzy matching — an adjusted quote is a fabricated citation; `occurrences` lets the caller
// reject ambiguous matches instead of taking the first.
export interface QuoteLocation {
  startByte: number
  endByte: number
  occurrences: number
}

export function locateQuote(text: string, quote: string): QuoteLocation | null {
  if (quote === '') return null

  const haystack = Buffer.from(text, 'utf8')
  const needle = Buffer.from(quote, 'utf8')
  const startByte = haystack.indexOf(needle)
  if (startByte === -1) return null

  // One-byte stride catches overlapping repeats too; UTF-8 is self-synchronising, so it can't match mid-character.
  let occurrences = 0
  for (let at = startByte; at !== -1; at = haystack.indexOf(needle, at + 1)) occurrences += 1

  return { startByte, endByte: startByte + needle.length, occurrences }
}

export function spanViolations(
  spans: Iterable<Span>,
  sources: ReadonlyMap<string, string>,
): { spanId: string; reason: string }[] {
  const violations: { spanId: string; reason: string }[] = []
  for (const span of spans) {
    const resolved = resolveSpan(span, sources)
    if (!resolved.ok) violations.push({ spanId: span.id, reason: resolved.reason })
  }
  return violations
}
