import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { AnswerCorrectionSchema, FindingReviewSchema, FindingSchema } from '@levelhead/contracts'
import {
  evaluateAnswer,
  openPinned,
  replay,
  SessionLog,
  topicById,
  type ArtifactContext,
} from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema, SessionIdParamsSchema, wireFindings } from './shared.ts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { GitRepository } from '../../../cli/src/repo/git-repository.ts'

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
          // A corrected answer still needs assessment when the original evaluator made no finding.
          pendingReassessment: (view.answerCorrections ?? []).some((correction) => {
            const latest = view.answerCorrections
              ?.filter((item) => item.attemptId === correction.attemptId)
              .at(-1)
            return (
              latest?.revision === correction.revision &&
              view.reassessedRevisions?.get(correction.attemptId) !== correction.revision
            )
          }),
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
      '/sessions/:id/reassess',
      {
        schema: {
          tags: ['feedback'],
          params: SessionIdParamsSchema,
          body: Type.Object({
            requestId: Type.String({ minLength: 1, maxLength: 128 }),
            attemptId: Type.String({ minLength: 1 }),
            revision: Type.Integer({ minimum: 2 }),
          }),
          response: {
            200: Type.Object({ revision: Type.Integer(), findings: Type.Integer() }),
            404: ErrorSchema,
            409: ErrorSchema,
            503: ErrorSchema,
          },
        },
      },
      async (request, reply) =>
        serialize(JSON.stringify([request.principal.ownerId, request.params.id]), async () => {
          const store = deps.storeFor(request.principal)
          const events = await store.read(request.params.id)
          if (!events.length) return reply.code(404).send({ error: 'no such session' })
          const view = replay(events)
          if (!view.closed || !view.session)
            return reply.code(409).send({ error: 'Finish the interview first' })
          const existing = events.find(
            (event) =>
              event.kind === 'state_change' &&
              'requestId' in event.payload &&
              event.payload.requestId === request.body.requestId,
          )
          if (existing?.kind === 'state_change') {
            const old = existing.payload
            if (
              old.change !== 'answer_reassessed' ||
              old.attemptId !== request.body.attemptId ||
              old.revision !== request.body.revision
            )
              return reply.code(409).send({ error: 'requestId collision' })
            return { revision: old.revision, findings: old.findings.length }
          }
          const correction = view.answerCorrections
            ?.filter((item) => item.attemptId === request.body.attemptId)
            .at(-1)
          if (!correction || correction.revision !== request.body.revision)
            return reply
              .code(409)
              .send({ error: 'Answer revision changed; reload before reassessing' })
          if (view.reassessedRevisions?.get(correction.attemptId) === correction.revision)
            return reply.code(409).send({ error: 'This revision was already reassessed' })
          const policy = events.find(
            (event) =>
              event.kind === 'policy_action' && event.payload.attemptId === correction.attemptId,
          )
          if (!policy || policy.kind !== 'policy_action')
            return reply.code(404).send({ error: 'Question policy unavailable' })
          // Reconstruct the claim set at interview start, rather than using a later edited claim.
          let claim = null
          if (policy.payload.claimId) {
            const claimEvents = await store.read(CLAIM_SET_SESSION)
            if (
              claimEvents.some(
                (event, index) =>
                  event.occurredAt === view.session!.startedAt ||
                  (index > 0 && event.occurredAt < claimEvents[index - 1]!.occurredAt),
              )
            )
              return reply
                .code(409)
                .send({ error: 'Original claim history cannot be ordered reliably' })
            const cutoff = claimEvents.findIndex(
              (event) => event.occurredAt > view.session!.startedAt,
            )
            const historical = replay(cutoff < 0 ? claimEvents : claimEvents.slice(0, cutoff))
            claim = historical.claims.get(policy.payload.claimId) ?? null
            if (!claim || !claim.confirmedByCandidate || !view.session.claimIds.includes(claim.id))
              return reply.code(409).send({ error: 'Original confirmed claim is unavailable' })
          }
          let artifact: ArtifactContext | undefined
          if (policy.payload.artifactId) {
            const id = view.session.snapshotId
            const pinnedEvent = events.find(
              (event) =>
                event.kind === 'state_change' && event.payload.change === 'snapshot_pinned',
            )
            const originalSnapshot =
              pinnedEvent?.kind === 'state_change' &&
              pinnedEvent.payload.change === 'snapshot_pinned'
                ? pinnedEvent.payload.snapshot
                : undefined
            const entry = openPinned(await store.read(REPO_SESSION), id)
            const source = entry?.artifacts.find((item) => item.id === policy.payload.artifactId)
            if (
              !entry ||
              !source ||
              !originalSnapshot ||
              entry.snapshot.commit !== originalSnapshot.commit ||
              entry.snapshot.id !== originalSnapshot.id
            )
              return reply
                .code(409)
                .send({ error: 'Original repository snapshot is unavailable or deleted' })
            const repository = new GitRepository({
              ids: deps.ids,
              clock: deps.clock,
              ...(deps.sourceRelocation ? { sourceRelocation: deps.sourceRelocation } : {}),
            })
            repository.register(entry.snapshot)
            const code = await repository.read(source)
            const live = openPinned(await store.read(REPO_SESSION), id)
            if (code === null || !live?.artifacts.some((item) => item.id === source.id))
              return reply
                .code(409)
                .send({ error: 'Original repository source is unavailable or deleted' })
            artifact = {
              artifactId: source.id,
              path: source.path,
              code,
              ...(source.symbol === undefined ? {} : { symbol: source.symbol }),
              ...(source.startLine === undefined ? {} : { startLine: source.startLine }),
              ...(source.endLine === undefined ? {} : { endLine: source.endLine }),
            }
          }
          const answerAt = view.transcript.findIndex(
            (turn) => turn.role === 'candidate' && turn.attemptId === correction.attemptId,
          )
          if (answerAt < 0) return reply.code(404).send({ error: 'Accepted answer unavailable' })
          const topic = policy.payload.topicId ? topicById(policy.payload.topicId) : undefined
          if (policy.payload.topicId && !topic)
            return reply.code(409).send({ error: 'Original topic is unavailable' })
          const result = await evaluateAnswer({
            attemptId: correction.attemptId,
            claim,
            ...(claim === null ? {} : { claimSpanId: claim.spanId }),
            ...(artifact === undefined ? {} : { artifact }),
            action: policy.payload.action,
            round: policy.payload.round,
            level: view.session.level,
            answerText: correction.text,
            answerSourceId: correction.sourceId,
            transcript: view.transcript.slice(0, answerAt + 1),
            rubricSet: view.session.rubricSet,
            ...(view.session.roleId ? { role: view.session.roleId } : {}),
            ...(view.session.design && policy.payload.round === 'system_design'
              ? { design: view.session.design }
              : {}),
            ...(topic ? { topic } : {}),
            evaluator: deps.evaluator,
            ids: deps.ids,
            clock: deps.clock,
          })
          if ('failed' in result)
            return reply
              .code(503)
              .send({ error: 'Reassessment failed; the correction remains unassessed' })
          if (
            artifact &&
            !openPinned(await store.read(REPO_SESSION), view.session.snapshotId)?.artifacts.some(
              (item) => item.id === artifact!.artifactId,
            )
          )
            return reply.code(409).send({ error: 'Repository was deleted during reassessment' })
          const log = await SessionLog.open(
            { store, clock: deps.clock, ids: deps.ids },
            request.params.id,
          )
          await log.append('state_change', {
            change: 'answer_reassessed',
            ...request.body,
            findings: wireFindings(result.findings),
            spans: result.spans,
            evidence: result.evidence,
            invocation: result.invocation,
          })
          return { revision: correction.revision, findings: result.findings.length }
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
