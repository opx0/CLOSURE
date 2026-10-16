import { Type, type Static } from '@sinclair/typebox'
import { ClaimTypeSchema, type Claim, type InvocationRecord, type Span } from '@levelhead/contracts'
import { claimExtractionPrompt } from '@levelhead/prompts'
import { locateQuote } from '../events/sources.ts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { EvaluatorPort, StructuredFailure } from '../ports/evaluator.ts'

// Mirrors `claim-extraction@v1` but omits ids, span and `confirmedByCandidate` — a field the model
// can fill is a field it can invent; those three are decided by code.
export const ExtractedClaimsSchema = Type.Object(
  {
    claims: Type.Array(
      Type.Object(
        {
          quote: Type.String({ minLength: 1 }),
          assertion: Type.String({ minLength: 1 }),
          type: ClaimTypeSchema,
          technologies: Type.Array(Type.String({ minLength: 1 })),
          metrics: Type.Array(Type.String({ minLength: 1 })),
          implied: Type.Boolean(),
        },
        // Required by Anthropic's json_schema output format; also stops the model adding its own fields.
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)
export type ExtractedClaims = Static<typeof ExtractedClaimsSchema>

export interface ExtractClaimsInput {
  resumeText: string
  sourceId: string
  evaluator: EvaluatorPort
  ids: IdSource
  clock: Clock
  maxOutputTokens?: number
}

// Covers both quotes that cost their claim and quotes that only made the span ambiguous — shown to
// the candidate so a dropped claim isn't silent.
export interface RejectedQuote {
  quote: string
  reason: string
}

export type ExtractionResult =
  | { claims: Claim[]; spans: Span[]; invocation: InvocationRecord; rejected: RejectedQuote[] }
  | { failed: StructuredFailure; invocation: InvocationRecord }

// Set high on purpose: within this budget, a `max_tokens` stop means extraction went wrong, not that the résumé was long.
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export async function extractClaims(input: ExtractClaimsInput): Promise<ExtractionResult> {
  const { system, user } = claimExtractionPrompt.render({ resumeText: input.resumeText })
  const result = await input.evaluator.complete({
    promptId: claimExtractionPrompt.id,
    promptVersion: claimExtractionPrompt.version,
    promptHash: claimExtractionPrompt.hash,
    system,
    user,
    schema: ExtractedClaimsSchema,
    schemaName: 'ExtractedClaims',
    maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  })

  // From the injected clock, not the adapter's wall clock — a replayed extraction must reproduce this byte-for-byte.
  const invocation: InvocationRecord = { ...result.invocation, occurredAt: input.clock.now() }

  // An empty list here would read as "your résumé makes no claims" — false, not merely absent (ADR-012).
  if (!result.ok) return { failed: result.failure, invocation }

  const extractorVersion = `${claimExtractionPrompt.id}@v${claimExtractionPrompt.version}#${claimExtractionPrompt.hash}`
  const claims: Claim[] = []
  const spans: Span[] = []
  const rejected: RejectedQuote[] = []

  for (const proposed of result.value.claims) {
    const at = locateQuote(input.resumeText, proposed.quote)

    // A quote not found verbatim is dropped, not repaired or nearest-matched — that would attribute words the candidate never wrote.
    if (at === null) {
      rejected.push({
        quote: proposed.quote,
        reason: 'quote does not appear in the résumé verbatim',
      })
      continue
    }

    // Not a rejection — the claim keeps its span — but the chosen-not-found span is still logged here.
    if (at.occurrences > 1) {
      rejected.push({
        quote: proposed.quote,
        reason: `quote appears ${at.occurrences} times; the span points at the first occurrence`,
      })
    }

    const span: Span = {
      id: input.ids.next('span'),
      sourceId: input.sourceId,
      startByte: at.startByte,
      endByte: at.endByte,
      quoted: proposed.quote,
    }
    spans.push(span)

    claims.push({
      id: input.ids.next('claim'),
      spanId: span.id,
      type: proposed.type,
      assertion: proposed.assertion,
      technologies: proposed.technologies,
      metrics: proposed.metrics,
      implied: proposed.implied,
      // §4.1: nothing starts confirmed — stated claims no more than implied ones.
      confirmedByCandidate: false,
      extractorVersion,
    })
  }

  return { claims, spans, invocation, rejected }
}
