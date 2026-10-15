import type { Static, TSchema } from '@sinclair/typebox'
import type { InvocationRecord } from '@levelhead/contracts'

// ADR-011's controlled path: one call, strict schema, no tool-using agent loop — an agent chewing on
// untrusted résumé text is a prompt-injection amplifier.
export interface StructuredRequest<T extends TSchema> {
  promptId: string
  promptVersion: number
  promptHash: string
  system: string
  user: string
  schema: T
  schemaName: string
  maxOutputTokens: number
}

// ADR-012/research 02: `stop_reason` refusal/max_tokens and a null parse map to these — never coerced into a valid-looking result.
export type StructuredFailure =
  | { kind: 'refusal' }
  | { kind: 'max_tokens' }
  | { kind: 'unparseable'; raw: string }
  | { kind: 'schema_mismatch'; errors: string[]; raw: string }
  | { kind: 'transport'; message: string }

export type StructuredResult<V> =
  | { ok: true; value: V; invocation: InvocationRecord }
  | { ok: false; failure: StructuredFailure; invocation: InvocationRecord }

export interface EvaluatorPort {
  complete<T extends TSchema>(request: StructuredRequest<T>): Promise<StructuredResult<Static<T>>>
}
