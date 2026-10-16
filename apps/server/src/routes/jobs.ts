import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { JobKindSchema, JobRecordSchema } from '@levelhead/contracts'
import { idempotencyKeyFor } from '@levelhead/db'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const NO_QUEUE = {
  error: 'no durable queue is configured',
  detail: 'set LEVELHEAD_STORE=postgres and DATABASE_URL; the file-backed store has no job table',
}

// Work that must survive a crash goes here rather than into a request that might not finish
// (ADR-009). Nothing an interview turn does is enqueued.
export function jobRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/jobs',
      {
        schema: {
          summary: 'Recent durable jobs for this owner',
          tags: ['jobs'],
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
          }),
          response: { 200: Type.Object({ jobs: Type.Array(JobRecordSchema) }), 503: ErrorSchema },
        },
      },
      async (request, reply) => {
        if (deps.queue === null) return reply.code(503).send(NO_QUEUE)
        return {
          jobs: await deps.queue.list(request.principal.ownerId, request.query.limit ?? 50),
        }
      },
    )

    app.get(
      '/jobs/:id',
      {
        schema: {
          summary: 'One job, including the error that buried it',
          tags: ['jobs'],
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: {
            200: Type.Object({ job: JobRecordSchema }),
            404: ErrorSchema,
            503: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (deps.queue === null) return reply.code(503).send(NO_QUEUE)
        const job = await deps.queue.get(request.params.id)
        if (job === null || job.ownerId !== request.principal.ownerId) {
          return reply.code(404).send({ error: 'no such job', detail: request.params.id })
        }
        return { job }
      },
    )

    app.post(
      '/jobs/export',
      {
        schema: {
          summary: 'Queue an export bundle to be written to disk',
          tags: ['jobs'],
          body: Type.Object({
            destination: Type.String({ minLength: 1, pattern: '^[A-Za-z0-9._-]+$' }),
          }),
          response: { 202: Type.Object({ job: JobRecordSchema }), 503: ErrorSchema },
        },
      },
      async (request, reply) => {
        if (deps.queue === null) return reply.code(503).send(NO_QUEUE)
        const job = await deps.queue.enqueue({
          ownerId: request.principal.ownerId,
          kind: 'build_export',
          payload: { kind: 'build_export', destination: request.body.destination },
          idempotencyKey: idempotencyKeyFor('build_export', [request.body.destination]),
        })
        return reply.code(202).send({ job })
      },
    )

    app.post(
      '/jobs/retention',
      {
        schema: {
          summary: 'Queue a retention sweep over expired repository snapshots',
          tags: ['jobs'],
          body: Type.Object({
            snapshotMaxAgeDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
          }),
          response: { 202: Type.Object({ job: JobRecordSchema }), 503: ErrorSchema },
        },
      },
      async (request, reply) => {
        if (deps.queue === null) return reply.code(503).send(NO_QUEUE)
        const days = request.body.snapshotMaxAgeDays ?? 90
        const job = await deps.queue.enqueue({
          ownerId: request.principal.ownerId,
          kind: 'sweep_retention',
          payload: { kind: 'sweep_retention', snapshotMaxAgeDays: days },
          idempotencyKey: idempotencyKeyFor('sweep_retention', [
            String(days),
            new Date().toISOString().slice(0, 10),
          ]),
        })
        return reply.code(202).send({ job })
      },
    )

    app.get(
      '/jobs/kinds',
      {
        schema: {
          summary: 'The job kinds this build knows how to run',
          tags: ['jobs'],
          response: { 200: Type.Object({ kinds: Type.Array(JobKindSchema) }) },
        },
      },
      async () => ({
        kinds: [
          'ingest_repository' as const,
          'build_export' as const,
          'sweep_retention' as const,
          'plan_retrieval' as const,
          'run_benchmark' as const,
        ],
      }),
    )
  }
}
