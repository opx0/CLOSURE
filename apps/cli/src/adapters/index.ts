import type { ConductorPort, EvaluatorPort } from '@levelhead/core'
import { OpenAiCompatibleConductor } from './conductor-openai.ts'
import { StructuredEvaluator } from './evaluator-structured.ts'
import { LOCAL_MODEL_ALIAS } from './pricing.ts'
import { defaultResilience, DEFAULT_IN_FLIGHT } from './resilience.ts'

export * from './pricing.ts'
export * from './resilience.ts'
export * from './openai-compatible.ts'
export * from './conductor-openai.ts'
export * from './evaluator-structured.ts'

// Index signature lets `process.env` itself be passed without a cast.
export interface AdapterEnv {
  LLAMA_BASE_URL?: string | undefined
  MODEL_ID?: string | undefined
  MODEL_PROVIDER_API_KEY?: string | undefined
  [key: string]: string | undefined
}

export interface Adapters {
  conductor: ConductorPort
  evaluator: EvaluatorPort
}

export function fromEnv(env: AdapterEnv = process.env): Adapters {
  const localBaseUrl = env.LLAMA_BASE_URL ?? 'http://localhost:8081/v1'
  const apiKey = env.MODEL_PROVIDER_API_KEY || undefined
  // One limiter across both ports: the provider counts requests, not which port made them
  // (STACK §9.4).
  const resilience = defaultResilience(Number(env.MODEL_MAX_IN_FLIGHT ?? String(DEFAULT_IN_FLIGHT)))

  return {
    // Always local: latency matters in the conversational path, determinism doesn't.
    conductor: new OpenAiCompatibleConductor({
      baseUrl: localBaseUrl,
      modelAlias: LOCAL_MODEL_ALIAS,
      resilience,
    }),
    // Alias falls back with the endpoint — billing MODEL_ID's price for local-model tokens would
    // corrupt the session cost ceiling.
    evaluator: new StructuredEvaluator({
      modelAlias: apiKey ? (env.MODEL_ID ?? 'claude-opus-5') : LOCAL_MODEL_ALIAS,
      apiKey,
      localBaseUrl,
      resilience,
    }),
  }
}
