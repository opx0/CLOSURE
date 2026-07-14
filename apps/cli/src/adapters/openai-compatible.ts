import type { StopReason } from '@closer/contracts'
import { guarded, type ProviderResilience } from './resilience.ts'

// Only the fields CLOSER reads are typed — a crash-looped local server can still return HTML with a 200.
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
): Promise<ChatCompletionResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  return guarded(resilience, async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })

    if (!response.ok) throw new ProviderHttpError(response.status, await response.text())
    return (await response.json()) as ChatCompletionResponse
  })
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
