import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { metrics } from '@closer/observability'

// Opaque counters only: no candidate content ever reaches a metric label (STACK §15).
export const metricsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    await reply.type('text/plain; version=0.0.4').send(metrics.render())
  })
}
