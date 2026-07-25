import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { DeliveryReportSchema, SpokenTurnSchema } from '@closer/contracts'
import { SessionLog, measureDelivery, replay } from '@closer/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema, SessionIdParamsSchema } from './shared.ts'

// Voice is an I/O layer over the unchanged text engine. Pace, pauses and filler words are recorded
// here and nowhere else: they never become a finding, never reach the rubric, and never enter the
// gap ledger (PROJECT.md §7, §10 stage 8).
export function deliveryRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/sessions/:id/delivery',
      {
        schema: {
          summary: 'Record observable delivery for one spoken answer — never part of any judgment',
          tags: ['delivery'],
          params: SessionIdParamsSchema,
          body: SpokenTurnSchema,
          response: {
            201: Type.Object({
              report: DeliveryReportSchema,
              boundary: Type.String({ minLength: 1 }),
            }),
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const store = deps.storeFor(request.principal)
        const events = await store.read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        const view = replay(events)
        if (!view.attempts.has(request.body.attemptId)) {
          return reply
            .code(404)
            .send({ error: 'no such attempt in this session', detail: request.body.attemptId })
        }

        const report = measureDelivery(request.body)
        const log = await SessionLog.open(
          { store, clock: deps.clock, ids: deps.ids },
          request.params.id,
        )
        await log.append('state_change', { change: 'delivery_recorded', report })

        return reply.code(201).send({
          report,
          boundary:
            'Delivery observations only. They say nothing about whether the answer was any good.',
        })
      },
    )

    app.get(
      '/sessions/:id/delivery',
      {
        schema: {
          summary: 'Delivery observations recorded for this session',
          tags: ['delivery'],
          params: SessionIdParamsSchema,
          response: {
            200: Type.Object({ reports: Type.Array(DeliveryReportSchema) }),
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        return { reports: [...replay(events).delivery] }
      },
    )
  }
}
