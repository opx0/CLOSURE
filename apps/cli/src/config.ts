import { LOCAL_OWNER_ID } from '@closer/contracts'

// DATABASE_URL is deliberately not required — the default `jsonl` store needs no running container.
export interface CliConfig {
  ownerId: string
  store: 'jsonl' | 'postgres'
  databaseUrl: string | undefined
  eventDir: string
  llamaBaseUrl: string
  modelId: string
  apiKey: string | undefined
  sessionCostCeilingUsd: number
  sessionTokenCeiling: number
  modelCallsPerTurnCeiling: number
}

export function loadCliConfig(env: Record<string, string | undefined> = process.env): CliConfig {
  return {
    // ADR-023: one fixed local owner in development, a real identity later, and the same boundary
    // either way.
    ownerId: env.CLOSER_OWNER ?? LOCAL_OWNER_ID,
    store: env.CLOSER_STORE === 'postgres' ? 'postgres' : 'jsonl',
    databaseUrl: env.DATABASE_URL,
    eventDir: env.CLOSER_EVENT_DIR ?? '.closer/events',
    llamaBaseUrl: env.LLAMA_BASE_URL ?? 'http://localhost:8081/v1',
    modelId: env.MODEL_ID ?? 'claude-opus-5',
    apiKey: env.MODEL_PROVIDER_API_KEY,
    sessionCostCeilingUsd: Number(env.SESSION_COST_CEILING_USD ?? '2.00'),
    sessionTokenCeiling: Number(env.SESSION_TOKEN_CEILING ?? '120000'),
    modelCallsPerTurnCeiling: Number(env.MODEL_CALLS_PER_TURN_CEILING ?? '3'),
  }
}
