import { Type, type Static } from '@sinclair/typebox'

// ADR-011: the Conductor is generative and latency-bound; the Evaluator is the controlled, honesty-critical path. Every model call is attributed to one.
export const PortSchema = Type.Union([Type.Literal('conductor'), Type.Literal('evaluator')])
export type Port = Static<typeof PortSchema>

// ADR-012's third caller-side check, a null parse, is not a stop reason — it's carried by the failure type instead.
export const StopReasonSchema = Type.Union([
  Type.Literal('end_turn'),
  Type.Literal('max_tokens'),
  Type.Literal('refusal'),
  Type.Literal('stop_sequence'),
  Type.Literal('other'),
])
export type StopReason = Static<typeof StopReasonSchema>

// Models retire and can't be pinned, so a result stays attributable only if the alias, prompt hash and token counts are recorded beside it at call time (ticket 10 §2).
export const InvocationRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  port: PortSchema,
  modelAlias: Type.String({ minLength: 1 }),
  promptId: Type.String({ minLength: 1 }),
  promptVersion: Type.Integer({ minimum: 1 }),
  promptHash: Type.String({ minLength: 1 }),
  inputTokens: Type.Integer({ minimum: 0 }),
  outputTokens: Type.Integer({ minimum: 0 }),
  costUsd: Type.Number({ minimum: 0 }),
  stopReason: StopReasonSchema,
  latencyMs: Type.Integer({ minimum: 0 }),
  occurredAt: Type.String({ format: 'date-time' }),
})
export type InvocationRecord = Static<typeof InvocationRecordSchema>
