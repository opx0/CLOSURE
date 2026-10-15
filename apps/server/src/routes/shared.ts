import { Type, type Static } from '@sinclair/typebox'
import { FindingSchema, type Finding } from '@levelhead/contracts'
import type { SessionView } from '@levelhead/core'

// The id becomes a filename in the JSONL store — this pattern turns `../../etc/passwd` into a 400
// here, not a 500 from the adapter that refused to open it.
export const SessionIdParamsSchema = Type.Object({
  id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
})

export const ErrorSchema = Type.Object({
  error: Type.String(),
  detail: Type.Optional(Type.String()),
})

export const QuotedEvidenceSchema = Type.Object({
  evidenceId: Type.String({ minLength: 1 }),
  quoted: Type.String(),
})

// Widens `Finding`'s non-empty tuples to the schema's plain arrays — safe, and the same widening
// the CLI makes when writing to the log.
export function wireFindings(findings: readonly Finding[]): Static<typeof FindingSchema>[] {
  return findings as unknown as Static<typeof FindingSchema>[]
}

// Sent alongside findings rather than folded into them — `Finding` is a contract, and a response
// isn't the place to grow a variant of it.
export function quotesFrom(view: SessionView): { evidenceId: string; quoted: string }[] {
  const quotes: { evidenceId: string; quoted: string }[] = []
  for (const link of view.evidence.values()) {
    if (link.target.kind !== 'span') continue
    const span = view.spans.get(link.target.spanId)
    if (span !== undefined) quotes.push({ evidenceId: link.id, quoted: span.quoted })
  }
  return quotes
}
