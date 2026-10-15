import { createServer } from 'node:http'
import { Pool } from 'pg'
import { LOCAL_OWNER_ID, type OwnerId } from '@levelhead/contracts'
import { PostgresEventStore, PostgresJobQueue, PostgresRetrieval } from '@levelhead/db'
import { createLogger, metrics, startTracing } from '@levelhead/observability'
import { RandomIds, SystemClock } from '../../cli/src/runtime.ts'
import { outreachFrom } from './adapters/index.ts'
import { loadWorkerConfig } from './config.ts'
import { JobRunner } from './runner.ts'
import type { HandlerContext } from './handlers/index.ts'

const config = loadWorkerConfig()
const logger = createLogger({ level: config.LOG_LEVEL, service: 'levelhead-worker' })
const tracing = await startTracing({
  serviceName: 'levelhead-worker',
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_ENABLED,
})

const pool = new Pool({ connectionString: config.DATABASE_URL })
const ids = new RandomIds()
const clock = new SystemClock()
const retrieval = new PostgresRetrieval(pool)
const queue = new PostgresJobQueue(pool, () => ids.next('job'))

const context: HandlerContext = {
  config,
  storeFor: (ownerId: OwnerId) => new PostgresEventStore(pool, ownerId),
  retrieval,
  queue,
  outreach: outreachFrom(config, clock),
  logger,
  clock,
  ids,
}

const runner = new JobRunner(
  queue,
  context,
  {
    name: config.WORKER_NAME,
    pollMs: config.WORKER_POLL_MS,
    leaseSeconds: config.WORKER_LEASE_SECONDS,
    batch: config.WORKER_BATCH,
  },
  logger,
)

const metricsServer =
  config.WORKER_METRICS_PORT === 0
    ? null
    : createServer((request, response) => {
        if (request.url !== '/metrics') {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
        response.end(metrics.render())
      }).listen(config.WORKER_METRICS_PORT)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.log('info', 'shutting down', { signal })
  await runner.stop()
  metricsServer?.close()
  await tracing.shutdown()
  await pool.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

logger.log('info', 'worker ready', {
  name: config.WORKER_NAME,
  ownerScope: LOCAL_OWNER_ID,
  pollMs: config.WORKER_POLL_MS,
  nudgeDelivery: context.outreach.describe(),
})
await runner.loop()
