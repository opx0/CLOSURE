import type { FastifyInstance } from 'fastify'
import { silentLogger, type JobQueuePort } from '@levelhead/core'
import { buildApp } from '../app.ts'
import type { Config } from '../config.ts'
import type { ServerDeps } from '../deps.ts'
import {
  FixedClock,
  MemoryEventStore,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
} from '../../../cli/src/testing/fakes.ts'

// Reuses the CLI's fakes — a second set here would let HTTP tests pass on shapes the real model
// could never return.
const TEST_CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  LEVELHEAD_EVENT_DIR: '.levelhead/events',
  LEVELHEAD_EXPORT_DIR: '.levelhead/exports',
  LEVELHEAD_STORE: 'jsonl',
  SESSION_TOKEN_CEILING: 120_000,
  SESSION_COST_CEILING_USD: 2,
  MODEL_CALLS_PER_TURN_CEILING: 3,
  LEVELHEAD_API_TOKENS: '',
  LEVELHEAD_CORS_ORIGIN: '',
  LEVELHEAD_RATE_LIMIT_PER_MINUTE: 10_000,
  LEVELHEAD_MAX_BODY_BYTES: 256 * 1024,
  LEVELHEAD_DEMO_MODE: false,
  LEVELHEAD_PREVIEW_MODE: false,
  LEVELHEAD_WEB_DIST: 'apps/web/dist',
  SNAPSHOT_RETENTION_DAYS: 90,
  OTEL_ENABLED: false,
}

export const RESUME = 'Built a durable job queue on PostgreSQL processing ~10k jobs/day.\n'
export const RESUME_QUOTE = 'Built a durable job queue on PostgreSQL'
export const ANSWER =
  'We leased each job for 30 seconds. I do not think we handled double completion.'
export const ANSWER_QUOTE = 'I do not think we handled double completion'

export const EXTRACTION = {
  claims: [
    {
      quote: RESUME_QUOTE,
      assertion: 'built a durable job queue on PostgreSQL',
      type: 'built',
      technologies: ['PostgreSQL'],
      metrics: ['10k jobs/day'],
      implied: false,
    },
  ],
}

export function judged(quote: string) {
  return {
    findings: [
      {
        kind: 'claim',
        verdict: 'partially_supported',
        rationale: 'lease recovery is described; duplicate completion is not',
        confidence: 0.8,
        quotes: [quote],
      },
    ],
  }
}

export interface TestApi {
  app: FastifyInstance
  store: MemoryEventStore
}

// One evaluator queue serves extraction and evaluation, in call order — as one Evaluator port does
// in production too.
export async function testApi(
  input: {
    questions?: readonly string[]
    scripted?: readonly unknown[]
    config?: Partial<Config>
    queue?: JobQueuePort
    deps?: Partial<ServerDeps>
  } = {},
): Promise<TestApi> {
  const store = new MemoryEventStore()
  const deps: ServerDeps = {
    storeFor: () => store,
    clock: new FixedClock(),
    ids: new SeqIds(),
    conductor: new ScriptedConductor(input.questions ?? []),
    evaluator: new ScriptedEvaluator(input.scripted ?? []),
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    logger: silentLogger,
    queue: input.queue ?? null,
    retrieval: null,
    ...input.deps,
  }
  const app = await buildApp({ ...TEST_CONFIG, ...input.config }, deps)
  await app.ready()
  return { app, store }
}

export async function confirmedClaim(app: FastifyInstance): Promise<string> {
  const extracted = await app.inject({
    method: 'POST',
    url: '/claims',
    payload: { resumeText: RESUME },
  })
  const body = extracted.json() as { claims: { id: string }[] }
  const claimId = body.claims[0]?.id
  if (claimId === undefined) throw new Error(`extraction returned no claims: ${extracted.body}`)

  await app.inject({
    method: 'POST',
    url: `/claims/${claimId}/confirm`,
    payload: { confirmed: true },
  })
  return claimId
}

export interface TurnBody {
  sessionId: string
  status: string
  question?: { attemptId: string; text: string }
  findings: { id: string; attemptId: string; evidenceIds: string[] }[]
  quotes: { evidenceId: string; quoted: string }[]
  notices: string[]
  stoppedBy?: string
}

export async function interviewed(
  app: FastifyInstance,
): Promise<{ start: TurnBody; turn: TurnBody }> {
  await confirmedClaim(app)
  const started = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { rounds: ['project_deep_dive'], mode: 'coach', turnsPerRound: 1, drill: false },
  })
  const start = started.json() as TurnBody
  const answered = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/answers`,
    payload: { text: ANSWER },
  })
  return { start, turn: answered.json() as TurnBody }
}
