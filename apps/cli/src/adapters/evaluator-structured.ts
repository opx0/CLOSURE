import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { InvocationRecord, StopReason } from '@closer/contracts'
import type {
  EvaluatorPort,
  StructuredFailure,
  StructuredRequest,
  StructuredResult,
} from '@closer/core'
import {
  mapFinishReason,
  postChatCompletion,
  ProviderHttpError,
  usageTokens,
  firstChoiceText,
} from './openai-compatible.ts'
import { costUsd, priceFor, type ModelPrice } from './pricing.ts'
import { guarded, type ProviderResilience } from './resilience.ts'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'

export interface StructuredEvaluatorConfig {
  modelAlias: string
  // Presence of a key picks Anthropic vs. the local OpenAI-compatible fallback. The local path is
  // for wiring only — not honesty-critical, and no calibration/agreement number may come from it.
  apiKey?: string | undefined
  localBaseUrl: string
  anthropicBaseUrl?: string | undefined
  // Retries are transport-level only. A schema violation is never retried into shape — an Evaluator
  // that quietly re-rolls a malformed answer makes every agreement number meaningless.
  resilience?: ProviderResilience | undefined
}

interface RawCompletion {
  text: string
  stopReason: StopReason
  inputTokens: number
  outputTokens: number
}

interface AnthropicMessage {
  content?: { type?: string; text?: string }[]
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

// One call, a strict schema, explicit failure — nothing here repairs or retries a malformed
// response into shape, since an Evaluator that quietly fixes the model's answer makes agreement
// numbers meaningless.
export class StructuredEvaluator implements EvaluatorPort {
  readonly #price: ModelPrice
  readonly #useAnthropic: boolean

  constructor(private readonly config: StructuredEvaluatorConfig) {
    this.#price = priceFor(config.modelAlias)
    this.#useAnthropic = Boolean(config.apiKey)
  }

  async complete<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<Static<T>>> {
    const startedAt = performance.now()
    let raw: RawCompletion

    try {
      raw = this.#useAnthropic
        ? await this.#callAnthropic(request)
        : await this.#callOpenAiCompatible(request)
    } catch (error) {
      // No usage to report, but still attributable: attempted, at a known time, against a known prompt hash.
      return {
        ok: false,
        failure: { kind: 'transport', message: messageOf(error) },
        invocation: this.#record(request, { inputTokens: 0, outputTokens: 0 }, 'other', startedAt),
      }
    }

    const invocation = this.#record(request, raw, raw.stopReason, startedAt)
    const fail = (failure: StructuredFailure): StructuredResult<Static<T>> => ({
      ok: false,
      failure,
      invocation,
    })

    // Decided by stop reason before the body is looked at — a truncated body often still parses.
    if (raw.stopReason === 'refusal') return fail({ kind: 'refusal' })
    if (raw.stopReason === 'max_tokens') return fail({ kind: 'max_tokens' })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.text)
    } catch {
      return fail({ kind: 'unparseable', raw: raw.text })
    }

    if (!Value.Check(request.schema, parsed)) {
      const errors = [...Value.Errors(request.schema, parsed)].map(
        (error) => `${error.path || '/'}: ${error.message}`,
      )
      return fail({ kind: 'schema_mismatch', errors, raw: raw.text })
    }

    return { ok: true, value: parsed as Static<T>, invocation }
  }

  async #callAnthropic<T extends TSchema>(request: StructuredRequest<T>): Promise<RawCompletion> {
    const base = (this.config.anthropicBaseUrl ?? ANTHROPIC_BASE_URL).replace(/\/$/, '')
    const body = await guarded(this.config.resilience, async () => {
      const response = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.config.modelAlias,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          // Sent verbatim — reshaping it would constrain the model by something other than what the
          // result is validated against.
          output_config: { format: { type: 'json_schema', schema: request.schema } },
        }),
      })

      if (!response.ok) throw new ProviderHttpError(response.status, await response.text())
      return (await response.json()) as AnthropicMessage
    })

    // Thinking is on by default on current Opus models, so JSON is in the first *text* block.
    const text = body.content?.find((block) => block.type === 'text')?.text ?? ''
    return {
      text,
      stopReason: mapAnthropicStopReason(body.stop_reason),
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    }
  }

  async #callOpenAiCompatible<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<RawCompletion> {
    const response = await postChatCompletion(
      this.config.localBaseUrl,
      this.config.apiKey,
      {
        model: this.config.modelAlias,
        max_tokens: request.maxOutputTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, schema: request.schema, strict: true },
        },
      },
      this.config.resilience,
    )

    return {
      text: firstChoiceText(response),
      stopReason: mapFinishReason(response.choices?.[0]?.finish_reason),
      ...usageTokens(response),
    }
  }

  #record<T extends TSchema>(
    request: StructuredRequest<T>,
    tokens: { inputTokens: number; outputTokens: number },
    stopReason: StopReason,
    startedAt: number,
  ): InvocationRecord {
    return {
      id: crypto.randomUUID(),
      port: 'evaluator',
      modelAlias: this.config.modelAlias,
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      promptHash: request.promptHash,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      costUsd: costUsd(this.#price, tokens.inputTokens, tokens.outputTokens),
      stopReason,
      latencyMs: Math.round(performance.now() - startedAt),
      occurredAt: new Date().toISOString(),
    }
  }
}

// `tool_use`/`pause_turn` are reachable but never asked for here, so they land in `other`.
function mapAnthropicStopReason(stopReason: string | null | undefined): StopReason {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    case 'stop_sequence':
      return 'stop_sequence'
    default:
      return 'other'
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
