import Fastify, { type FastifyInstance } from 'fastify'
import fastifySwagger from '@fastify/swagger'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { Config } from './config.ts'
import { healthRoutes } from './routes/health.ts'

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(fastifySwagger, {
    openapi: { info: { title: 'CLOSER API', version: '0.0.0' } },
  })
  app.get('/openapi.json', async () => app.swagger())
  await app.register(healthRoutes)

  return app
}
