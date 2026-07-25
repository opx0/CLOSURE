import { Pool } from 'pg'
import { LOCAL_OWNER_ID, type OwnerId, type Principal } from '@closer/contracts'
import { PostgresEventStore, PostgresJobQueue, PostgresRetrieval } from '@closer/db'
import { createLogger, startTracing } from '@closer/observability'
import type { EventStore, JobQueuePort, RetrievalPort } from '@closer/core'
import { loadConfig } from './config.ts'
import { buildApp } from './app.ts'
import { ownerOf } from './deps.ts'
// These live in apps/cli because the CLI was built first, not because they belong to it — they're
// transport-agnostic and imported rather than copied, so the two callers can't drift apart.
import { JsonlEventStore } from '../../cli/src/store/jsonl.ts'
import { fromEnv } from '../../cli/src/adapters/index.ts'
import { RandomIds, SystemClock } from '../../cli/src/runtime.ts'

const config = loadConfig()
const { conductor, evaluator } = fromEnv(process.env)
const logger = createLogger({ level: config.LOG_LEVEL, service: 'closer-server' })
const tracing = await startTracing({
  serviceName: 'closer-server',
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
})

const ids = new RandomIds()

const pool =
  config.CLOSER_STORE === 'postgres' && config.DATABASE_URL !== undefined
    ? new Pool({ connectionString: config.DATABASE_URL })
    : null

const storeFor = (owner: OwnerId | Principal): EventStore => {
  const ownerId = ownerOf(owner)
  return pool === null
    ? new JsonlEventStore(config.CLOSER_EVENT_DIR, ownerId)
    : new PostgresEventStore(pool, ownerId)
}

const queue: JobQueuePort | null =
  pool === null ? null : new PostgresJobQueue(pool, () => ids.next('job'))
const retrieval: RetrievalPort | null = pool === null ? null : new PostgresRetrieval(pool)

// The only place in the server that reads the environment. Everything below takes what it is given.
const app = await buildApp(config, {
  storeFor,
  clock: new SystemClock(),
  ids,
  conductor,
  evaluator,
  logger,
  queue,
  retrieval,
  ceilings: {
    sessionCostUsd: config.SESSION_COST_CEILING_USD,
    sessionTokens: config.SESSION_TOKEN_CEILING,
    modelCallsPerTurn: config.MODEL_CALLS_PER_TURN_CEILING,
  },
})

async function shutdown(signal: string): Promise<void> {
  logger.log('info', 'shutting down', { signal })
  await app.close()
  await tracing.shutdown()
  await pool?.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  logger.log('info', 'server listening', {
    port: config.PORT,
    store: config.CLOSER_STORE,
    ownerScope: LOCAL_OWNER_ID,
    demoMode: config.CLOSER_DEMO_MODE,
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
