import type { StopReason } from '@levelhead/contracts'
import { guarded, type ProviderResilience } from './resilience.ts'

// Only the fields Levelhead reads are typed — a crash-looped local server can still return HTML with a 200.
export interface ChatCompletionRequest {
  model: string
  messages: { role: 'system' | 'user'; content: string }[]
  temperature?: number
  max_tokens?: number
  response_format?: {
    type: 'json_schema'
    json_schema: { name: string; schema: unknown; strict: true }
  }
}

export interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export const DEFAULT_COMPLETION_TIMEOUT_MS = 60_000

export interface CompletionRequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`provider returned HTTP ${status}: ${body.slice(0, 500)}`)
    this.name = 'ProviderHttpError'
  }
}

// OpenAI has no `finish_reason: 'refusal'`; `content_filter` is the closest a local server emits.
export function mapFinishReason(finishReason: string | null | undefined): StopReason {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'other'
  }
}

// Every OpenAI-compatible call in the system goes through here, which is why the retry and the
// concurrency limiter live here rather than in each adapter (STACK §9.4).
export async function postChatCompletion(
  baseUrl: string,
  apiKey: string | undefined,
  request: ChatCompletionRequest,
  resilience?: ProviderResilience,
  options: CompletionRequestOptions = {},
): Promise<ChatCompletionResponse> {
  if (
    request.max_tokens !== undefined &&
    (!Number.isSafeInteger(request.max_tokens) || request.max_tokens < 1)
  ) {
    throw new RangeError('max_tokens must be a positive integer')
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must be a positive integer within the timer range')
  }
  const deadline = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal
  const timer = setTimeout(
    () => deadline.abort(new DOMException('Completion deadline exceeded', 'TimeoutError')),
    timeoutMs,
  )
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  try {
    return await guarded(resilience, async () => {
      // One deadline covers retries and response consumption; an expired call cannot start again.
      signal.throwIfAborted()
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal,
      })

      if (!response.ok) {
        // Provider error bodies can echo the untrusted source/transcript sent in the request.
        await response.body?.cancel()
        throw new ProviderHttpError(response.status, '')
      }
      try {
        return (await response.json()) as ChatCompletionResponse
      } catch (error) {
        signal.throwIfAborted()
        /* eslint-disable preserve-caught-error -- Provider messages/causes can contain sensitive input. */
        // Preserve retryable body transport failures without retaining sensitive diagnostics.
        if (error instanceof TypeError)
          throw new TypeError('Provider response body transport failed')
        // JSON parser diagnostics may include provider-echoed source bytes too.
        if (error instanceof SyntaxError) throw new Error('Provider returned invalid JSON')
        throw new Error('Provider response body read failed')
        /* eslint-enable preserve-caught-error */
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

export function firstChoiceText(response: ChatCompletionResponse): string {
  return response.choices?.[0]?.message?.content ?? ''
}

export function usageTokens(response: ChatCompletionResponse): {
  inputTokens: number
  outputTokens: number
} {
  return {
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  }
}
