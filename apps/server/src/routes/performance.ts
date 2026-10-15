import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { KinematicsReportSchema, ProsodyReportSchema } from '@levelhead/contracts'
import { SessionLog, replay } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema, SessionIdParamsSchema } from './shared.ts'

// The performance lane's two ingest points. Prosody and kinematics are recorded beside the
// interview exactly as delivery is (PROJECT.md §7): they are observations of how an answer was
// delivered, they never become a finding, they never reach the rubric, and they never enter the gap
// ledger. Invariant 8 keeps that structural. These routes record; they never judge.
export function performanceRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/sessions/:id/prosody',
      {
        schema: {
          summary: 'Record prosody for one spoken answer — an observation, never a judgment',
          tags: ['performance'],
          params: SessionIdParamsSchema,
          body: ProsodyReportSchema,
          response: {
            201: Type.Object({
              report: ProsodyReportSchema,
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

        const report = request.body
        const log = await SessionLog.open(
          { store, clock: deps.clock, ids: deps.ids },
          request.params.id,
        )
        await log.append('state_change', { change: 'prosody_recorded', report })

        return reply.code(201).send({
          report,
          boundary:
            'Prosody observations only. They say nothing about whether the answer was any good.',
        })
      },
    )

    app.post(
      '/sessions/:id/kinematics',
      {
        schema: {
          summary: 'Record kinematics for one spoken answer — an observation, never a judgment',
          tags: ['performance'],
          params: SessionIdParamsSchema,
          body: KinematicsReportSchema,
          response: {
            201: Type.Object({
              report: KinematicsReportSchema,
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

        const report = request.body
        const log = await SessionLog.open(
          { store, clock: deps.clock, ids: deps.ids },
          request.params.id,
        )
        await log.append('state_change', { change: 'kinematics_recorded', report })

        return reply.code(201).send({
          report,
          boundary:
            'Kinematics observations only. Where the body was, never an expression or an inner state.',
        })
      },
    )

    app.get(
      '/sessions/:id/performance',
      {
        schema: {
          summary: 'Raw prosody and kinematics recorded for this session',
          tags: ['performance'],
          params: SessionIdParamsSchema,
          response: {
            200: Type.Object({
              prosody: Type.Array(ProsodyReportSchema),
              kinematics: Type.Array(KinematicsReportSchema),
            }),
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        const view = replay(events)
        return { prosody: [...view.prosody], kinematics: [...view.kinematics] }
      },
    )
  }
}
