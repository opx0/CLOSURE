import type { InvocationRecord } from '@levelhead/contracts'
import type {
  ConductorPort,
  RenderQuestionInput,
  RenderRoundBriefInput,
  RenderedQuestion,
} from '@levelhead/core'
import { questionRenderPrompt, roundBriefPrompt } from '@levelhead/prompts'
import {
  firstChoiceText,
  mapFinishReason,
  postChatCompletion,
  usageTokens,
} from './openai-compatible.ts'
import { costUsd, priceFor, type ModelPrice } from './pricing.ts'
import type { ProviderResilience } from './resilience.ts'

export interface OpenAiCompatibleConductorConfig {
  baseUrl: string
  modelAlias: string
  apiKey?: string | undefined
  temperature?: number | undefined
  maxOutputTokens?: number | undefined
  // Shared with the Evaluator when both are built together: the provider counts requests, not
  // which port made them.
  resilience?: ProviderResilience | undefined
}

// No failure union — a question that can't be rendered ends the turn, not a fallback nobody chose.
export class OpenAiCompatibleConductor implements ConductorPort {
  readonly #price: ModelPrice

  constructor(private readonly config: OpenAiCompatibleConductorConfig) {
    if (
      !Number.isSafeInteger(config.maxOutputTokens ?? 512) ||
      (config.maxOutputTokens ?? 512) < 1
    ) {
      throw new RangeError('maxOutputTokens must be a positive integer')
    }
    this.#price = priceFor(config.modelAlias)
  }

  async renderQuestion(input: RenderQuestionInput): Promise<RenderedQuestion> {
    const { system, user } = questionRenderPrompt.render({
      action: input.action,
      pressureLevel: input.pressureLevel,
      level: input.level,
      personaId: input.personaId,
      claim: input.claim,
      transcript: input.transcript,
      seed: input.seed,
      round: input.round,
      ...(input.topic === undefined
        ? {}
        : { topic: { area: input.topic.area, title: input.topic.title, ask: input.topic.ask } }),
      ...(input.artifact === undefined
        ? {}
        : {
            artifact: {
              path: input.artifact.path,
              symbol: input.artifact.symbol,
              startLine: input.artifact.startLine,
              endLine: input.artifact.endLine,
              code: input.artifact.code,
              repositoryContext: input.artifact.repositoryContext,
            },
          }),
    })

    const startedAt = performance.now()
    const response = await postChatCompletion(
      this.config.baseUrl,
      this.config.apiKey,
      {
        model: this.config.modelAlias,
        max_tokens: this.config.maxOutputTokens ?? 512,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
      },
      this.config.resilience,
    )
    const latencyMs = Math.round(performance.now() - startedAt)

    const { inputTokens, outputTokens } = usageTokens(response)
    const invocation: InvocationRecord = {
      id: crypto.randomUUID(),
      port: 'conductor',
      modelAlias: this.config.modelAlias,
      promptId: questionRenderPrompt.id,
      promptVersion: questionRenderPrompt.version,
      promptHash: questionRenderPrompt.hash,
      inputTokens,
      outputTokens,
      costUsd: costUsd(this.#price, inputTokens, outputTokens),
      stopReason: mapFinishReason(response.choices?.[0]?.finish_reason),
      latencyMs,
      occurredAt: new Date().toISOString(),
    }

    // Only `text` and `invocation` — an action, question-type or difficulty here would be the model
    // taking the policy decision back from code.
    return { text: firstChoiceText(response).trim(), invocation }
  }

  async renderRoundBrief(input: RenderRoundBriefInput): Promise<RenderedQuestion> {
    const { system, user } = roundBriefPrompt.render({
      round: input.round,
      personaId: input.personaId,
      roundIndex: input.roundIndex,
      totalRounds: input.totalRounds,
      claim: input.claim,
      ...(input.artifact === undefined
        ? {}
        : { artifact: { path: input.artifact.path, symbol: input.artifact.symbol } }),
    })
    return this.#speak(system, user, roundBriefPrompt)
  }

  async #speak(
    system: string,
    user: string,
    prompt: { id: string; version: number; hash: string },
  ): Promise<RenderedQuestion> {
    const startedAt = performance.now()
    const response = await postChatCompletion(
      this.config.baseUrl,
      this.config.apiKey,
      {
        model: this.config.modelAlias,
        max_tokens: this.config.maxOutputTokens ?? 512,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
      },
      this.config.resilience,
    )
    const latencyMs = Math.round(performance.now() - startedAt)
    const { inputTokens, outputTokens } = usageTokens(response)
    return {
      text: firstChoiceText(response).trim(),
      invocation: {
        id: crypto.randomUUID(),
        port: 'conductor',
        modelAlias: this.config.modelAlias,
        promptId: prompt.id,
        promptVersion: prompt.version,
        promptHash: prompt.hash,
        inputTokens,
        outputTokens,
        costUsd: costUsd(this.#price, inputTokens, outputTokens),
        stopReason: mapFinishReason(response.choices?.[0]?.finish_reason),
        latencyMs,
        occurredAt: new Date().toISOString(),
      },
    }
  }
}
