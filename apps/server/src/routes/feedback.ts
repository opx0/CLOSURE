import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { AnswerCorrectionSchema, FindingReviewSchema, FindingSchema } from '@levelhead/contracts'
import { replay, SessionLog } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema, SessionIdParamsSchema, wireFindings } from './shared.ts'

const AuditSchema = Type.Object({
  corrections: Type.Array(Type.Object({ ...AnswerCorrectionSchema.properties, at: Type.String() })),
  reviews: Type.Array(Type.Object({ ...FindingReviewSchema.properties, at: Type.String() })),
  historicalFindings: Type.Array(FindingSchema),
  supersededFindingIds: Type.Array(Type.String()),
  pendingReassessment: Type.Boolean(),
})

export function feedbackRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const pending = new Map<string, Promise<unknown>>()
  async function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const write = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
    pending.set(key, write)
    try {
      return await write
    } finally {
      if (pending.get(key) === write) pending.delete(key)
    }
  }
  return async (app) => {
    app.get(
      '/sessions/:id/feedback',
      {
        schema: {
          tags: ['feedback'],
          params: SessionIdParamsSchema,
          response: { 200: AuditSchema, 404: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0)
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        const view = replay(events)
        if (view.closed === null)
          return reply.code(409).send({
            error: 'Finish the interview before reviewing feedback',
            detail: 'No partial-session audit is exposed.',
          })
        return {
          corrections: [...(view.answerCorrections ?? [])],
          reviews: [...(view.findingReviews ?? [])],
          historicalFindings: wireFindings(view.historicalFindings ?? view.findings),
          supersededFindingIds: [...(view.supersededFindings?.keys() ?? [])],
          pendingReassessment: (view.supersededFindings?.size ?? 0) > 0,
        }
      },
    )
    app.post(
      '/sessions/:id/corrections',
      {
        schema: {
          tags: ['feedback'],
          params: SessionIdParamsSchema,
          body: Type.Omit(AnswerCorrectionSchema, ['revision', 'sourceId']),
          response: {
            200: Type.Object({ revision: Type.Integer(), pendingReassessment: Type.Literal(true) }),
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) =>
        serialize(JSON.stringify([request.principal.ownerId, request.params.id]), async () => {
          const store = deps.storeFor(request.principal)
          const events = await store.read(request.params.id)
          if (events.length === 0)
            return reply.code(404).send({ error: 'no such session', detail: request.params.id })
          const view = replay(events)
          if (view.closed === null)
            return reply.code(409).send({
              error: 'Finish the interview before correcting an accepted answer',
              detail: 'Live ASR revisions are a separate operation.',
            })
          const prior = events.find(
            (event) =>
              event.kind === 'state_change' &&
              'requestId' in event.payload &&
              event.payload.requestId === request.body.requestId,
          )
          if (prior?.kind === 'state_change') {
            const old = prior.payload,
              body = request.body
            if (
              old.change !== 'answer_corrected' ||
              old.attemptId !== body.attemptId ||
              old.previousRevision !== body.previousRevision ||
              old.text !== body.text ||
              old.reason !== body.reason
            )
              return reply.code(409).send({
                error: 'requestId collision',
                detail: 'Use a new ID for a different correction.',
              })
            return { revision: old.revision, pendingReassessment: true as const }
          }
          if (
            !view.transcript.some(
              (turn) => turn.role === 'candidate' && turn.attemptId === request.body.attemptId,
            )
          )
            return reply.code(404).send({
              error: 'no accepted answer for this attempt',
              detail: request.body.attemptId,
            })
          const revision =
            view.answerCorrections
              ?.filter((correction) => correction.attemptId === request.body.attemptId)
              .at(-1)?.revision ?? 1
          if (revision !== request.body.previousRevision)
            return reply.code(409).send({
              error: 'answer revision conflict',
              detail: `Current revision is ${revision}; reload before editing.`,
            })
          const log = await SessionLog.open(
            { store, clock: deps.clock, ids: deps.ids },
            request.params.id,
          )
          await log.append('state_change', {
            change: 'answer_corrected',
            ...request.body,
            revision: revision + 1,
            sourceId: `answer:${request.body.attemptId}:revision:${revision + 1}`,
          })
          return { revision: revision + 1, pendingReassessment: true as const }
        }),
    )
    app.post(
      '/sessions/:id/feedback',
      {
        schema: {
          tags: ['feedback'],
          params: SessionIdParamsSchema,
          body: Type.Omit(FindingReviewSchema, ['reviewer']),
          response: {
            200: Type.Object({ state: Type.String() }),
            400: ErrorSchema,
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) =>
        serialize(JSON.stringify([request.principal.ownerId, request.params.id]), async () => {
          const store = deps.storeFor(request.principal)
          const events = await store.read(request.params.id)
          if (events.length === 0)
            return reply.code(404).send({ error: 'no such session', detail: request.params.id })
          const view = replay(events)
          if (view.closed === null)
            return reply.code(409).send({
              error: 'Finish the interview before reviewing findings',
              detail: 'Simulation feedback remains withheld.',
            })
          const prior = events.find(
            (event) =>
              event.kind === 'state_change' &&
              'requestId' in event.payload &&
              event.payload.requestId === request.body.requestId,
          )
          if (prior?.kind === 'state_change') {
            const old = prior.payload,
              body = request.body
            if (
              old.change !== 'finding_reviewed' ||
              old.findingId !== body.findingId ||
              old.state !== body.state ||
              old.reason !== body.reason ||
              JSON.stringify(old.sourceRefs) !== JSON.stringify(body.sourceRefs)
            )
              return reply.code(409).send({
                error: 'requestId collision',
                detail: 'Use a new ID for a different review.',
              })
            return { state: old.state }
          }
          if (
            !(view.historicalFindings ?? view.findings).some(
              (finding) => finding.id === request.body.findingId,
            )
          )
            return reply
              .code(404)
              .send({ error: 'no such finding in this session', detail: request.body.findingId })
          if (view.supersededFindings?.has(request.body.findingId))
            return reply.code(409).send({
              error: 'finding already superseded',
              detail: 'Review cannot reinstate retired feedback.',
            })
          if (request.body.state === 'confirmed_error' && request.body.sourceRefs.length === 0)
            return reply.code(400).send({
              error: 'A reviewed error needs a source reference',
              detail: 'Unresolved disagreement should use pending state.',
            })
          const log = await SessionLog.open(
            { store, clock: deps.clock, ids: deps.ids },
            request.params.id,
          )
          await log.append('state_change', {
            change: 'finding_reviewed',
            ...request.body,
            reviewer: 'candidate_self_review',
          })
          return { state: request.body.state }
        }),
    )
  }
}
