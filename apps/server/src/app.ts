import { join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { newCorrelationId } from '@closer/observability'
import type { Config } from './config.ts'
import type { ServerDeps } from './deps.ts'
import { SessionHost } from './session-host.ts'
import { contextPlugin } from './plugins/context.ts'
import { healthRoutes } from './routes/health.ts'
import { metricsRoutes } from './routes/metrics.ts'
import { claimsRoutes } from './routes/claims.ts'
import { sessionRoutes } from './routes/sessions.ts'
import { streamRoutes } from './routes/stream.ts'
import { ledgerRoutes } from './routes/ledger.ts'
import { scheduleRoutes } from './routes/schedule.ts'
import { reviewRoutes } from './routes/review.ts'
import { deliveryRoutes } from './routes/delivery.ts'
import { privacyRoutes } from './routes/privacy.ts'
import { jobRoutes } from './routes/jobs.ts'
import { catalogRoutes } from './routes/catalog.ts'
import { benchmarkRoutes } from './routes/benchmark.ts'
import { demoRoutes } from './routes/demo.ts'
import { uiRoutes } from './routes/ui.ts'

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

// Only place that knows both config and adapters — keeps `process.env` out of every route below it.
export async function buildApp(config: Config, deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: config.CLOSER_MAX_BODY_BYTES,
    genReqId: () => newCorrelationId(),
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(fastifyHelmet, {
    // The bundled page and the built client are same-origin and inline nothing they did not ship.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        scriptSrc: [`'self'`, `'unsafe-inline'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:'],
        connectSrc: [`'self'`, 'http://localhost:8091'],
        objectSrc: [`'none'`],
        frameAncestors: [`'none'`],
      },
    },
    crossOriginEmbedderPolicy: false,
  })

  await app.register(fastifyCors, {
    origin: config.CLOSER_CORS_ORIGIN === '' ? false : config.CLOSER_CORS_ORIGIN.split(','),
    credentials: false,
  })

  await app.register(fastifyRateLimit, {
    max: config.CLOSER_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Keyed by owner where one is known, so one tenant cannot spend another's budget.
    keyGenerator: (request) => `${request.principal?.ownerId ?? 'anonymous'}:${request.ip}`,
  })

  await app.register(contextPlugin, {
    tokens: config.CLOSER_API_TOKENS,
    demoMode: config.CLOSER_DEMO_MODE,
  })

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'CLOSER API',
        version: '0.0.0',
        description:
          'Practice-only interview mentor. Findings cite evidence, state confidence, and may ' +
          'abstain. No endpoint returns an aggregate readiness score, and none ever will.',
      },
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'owner token' },
        },
      },
    },
  })
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger())

  // Thrown exceptions mean a bug in CLOSER: one hook, a correlation id, a generic body (STACK §5).
  app.setErrorHandler(async (raised: unknown, request, reply) => {
    const error = raised as { statusCode?: number; name?: string; message?: string }
    const status = error.statusCode ?? 500
    if (status >= 500) {
      deps.logger.log('error', 'request failed', {
        correlationId: request.correlationId,
        route: request.routeOptions.url ?? request.url,
        error: error.name ?? 'Error',
      })
      return reply.code(status).send({
        error: 'internal error',
        detail: `correlation id ${request.correlationId}`,
      })
    }
    return reply.code(status).send({ error: error.message ?? 'request refused' })
  })

  // One host per app: routes must share the same in-flight-session map.
  const host = new SessionHost(deps)

  await app.register(healthRoutes)
  await app.register(metricsRoutes)
  await app.register(catalogRoutes)
  await app.register(demoRoutes(config.CLOSER_DEMO_MODE))
  await app.register(claimsRoutes(deps))
  await app.register(sessionRoutes(deps, host))
  await app.register(streamRoutes(host))
  await app.register(ledgerRoutes(deps))
  await app.register(scheduleRoutes(deps))
  await app.register(reviewRoutes(deps))
  await app.register(deliveryRoutes(deps))
  await app.register(privacyRoutes(deps))
  await app.register(jobRoutes(deps))
  await app.register(benchmarkRoutes(join(config.CLOSER_EXPORT_DIR, '..', 'benchmarks')))

  // The built client when it exists; the dependency-free voice page otherwise, so a fresh checkout
  // has a working interface before anything is built.
  const dist = resolve(config.CLOSER_WEB_DIST)
  if (await directoryExists(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/app/', index: ['index.html'] })
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && request.url.startsWith('/app/')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found', detail: request.url })
    })
  }
  await app.register(uiRoutes)

  return app
}
