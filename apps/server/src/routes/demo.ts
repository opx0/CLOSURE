import { randomUUID } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { readFile } from 'node:fs/promises'
import { ErrorSchema } from './shared.ts'

const SYNTHETIC_RESUME = 'fixtures/resume-sample.md'

// PROJECT.md §9: the public instance is shown on demand, runs on a synthetic résumé, and is not a
// service. Each visitor gets their own owner id for the life of the process, so one visitor's
// session is never visible to another, and nothing here is presented as durable.
export function demoRoutes(enabled: boolean): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/demo/token',
      {
        schema: {
          summary: 'Mint a throwaway owner token for the showcase instance',
          tags: ['demo'],
          response: {
            201: Type.Object({
              token: Type.String({ minLength: 1 }),
              ownerId: Type.String({ minLength: 1 }),
              syntheticResume: Type.String(),
              notice: Type.String({ minLength: 1 }),
            }),
            404: ErrorSchema,
          },
        },
      },
      async (_request, reply) => {
        if (!enabled) {
          return reply
            .code(404)
            .send({ error: 'this instance is not a showcase', detail: 'CLOSER_DEMO_MODE is off' })
        }

        const ownerId = `demo${randomUUID().replace(/-/g, '').slice(0, 12)}`
        const token = randomUUID()
        app.demoTokens.set(token, ownerId)

        const resume = await readFile(SYNTHETIC_RESUME, 'utf8').catch(() => '')
        return reply.code(201).send({
          token,
          ownerId,
          syntheticResume: resume,
          notice:
            'Showcase instance. Use the synthetic résumé above rather than your own: this process ' +
            'keeps nothing after it stops, and nothing here is a measured claim about anyone.',
        })
      },
    )
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    demoTokens: Map<string, string>
  }
}
