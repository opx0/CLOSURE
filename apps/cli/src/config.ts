import { LOCAL_OWNER_ID } from '@levelhead/contracts'
import { repositoryStrategy } from './repository-search.ts'
import type { RetrievalStrategy } from '@levelhead/core'

// DATABASE_URL is deliberately not required — the default `jsonl` store needs no running container.
export interface CliConfig {
  repositorySearch?: RetrievalStrategy
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
    ...(env.LEVELHEAD_REPOSITORY_SEARCH === undefined
      ? {}
      : { repositorySearch: repositoryStrategy(env.LEVELHEAD_REPOSITORY_SEARCH)! }),
    // ADR-023: one fixed local owner in development, a real identity later, and the same boundary
    // either way.
    ownerId: env.LEVELHEAD_OWNER ?? LOCAL_OWNER_ID,
    store: env.LEVELHEAD_STORE === 'postgres' ? 'postgres' : 'jsonl',
    databaseUrl: env.DATABASE_URL,
    eventDir: env.LEVELHEAD_EVENT_DIR ?? '.levelhead/events',
    llamaBaseUrl: env.LLAMA_BASE_URL ?? 'http://localhost:8081/v1',
    modelId: env.MODEL_ID ?? 'claude-opus-5',
    apiKey: env.MODEL_PROVIDER_API_KEY,
    sessionCostCeilingUsd: Number(env.SESSION_COST_CEILING_USD ?? '2.00'),
    sessionTokenCeiling: Number(env.SESSION_TOKEN_CEILING ?? '120000'),
    modelCallsPerTurnCeiling: Number(env.MODEL_CALLS_PER_TURN_CEILING ?? '3'),
  }
}
