import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Liveness probe',
        tags: ['system'],
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            uptimeSeconds: Type.Number(),
          }),
        },
      },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: process.uptime() }),
  )
}
