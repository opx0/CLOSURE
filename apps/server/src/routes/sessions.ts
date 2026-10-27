import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  ClaimSchema,
  EventSchema,
  EvidenceSchema,
  FindingSchema,
  GapEntrySchema,
  LevelSchema,
  ModeSchema,
  PersonaIdSchema,
  PolicyActionSchema,
  PressureLevelSchema,
  RoleIdSchema,
  RoundKindSchema,
  SessionSchema,
  SessionStateSchema,
  SpanSchema,
  InvocationRecordSchema,
  TopicAreaSchema,
} from '@levelhead/contracts'
import {
  AREA_ROUND,
  dueForRetrieval,
  gapsAcrossViews,
  SessionLog,
  topicById,
  nextTransferVariant,
  DEFAULT_ROLE_ID,
  openPinned,
  replay,
  resolveInterview,
  rolePack,
} from '@levelhead/core'
import type { EventStore, PinnedContext, PressureLevel } from '@levelhead/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { GitRepository } from '../../../cli/src/repo/git-repository.ts'
import type { ServerDeps } from '../deps.ts'
import type { SessionHost } from '../session-host.ts'
import {
  ErrorSchema,
  QuotedEvidenceSchema,
  SessionIdParamsSchema,
  quotesFrom,
  wireFindings,
} from './shared.ts'
import { ShownArtifactSchema } from './snapshots.ts'

// No score and no quality summary here — findings and their citations are the whole output, as in
// the terminal.
const TurnUpdateSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('awaiting_answer'), Type.Literal('closed')]),
  round: Type.Optional(
    Type.Object({
      kind: RoundKindSchema,
      index: Type.Integer({ minimum: 0 }),
      total: Type.Integer({ minimum: 1 }),
      brief: Type.Optional(Type.String()),
    }),
  ),
  question: Type.Optional(
    Type.Object({
      attemptId: Type.String({ minLength: 1 }),
      text: Type.String({ minLength: 1 }),
      turn: Type.Integer({ minimum: 0 }),
      // Chosen by code, never the model — the candidate is owed why a question was asked this way.
      action: PolicyActionSchema,
      pressureLevel: PressureLevelSchema,
      round: RoundKindSchema,
      topic: Type.Optional(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          area: TopicAreaSchema,
          title: Type.String({ minLength: 1 }),
        }),
      ),
      claim: Type.Optional(
        Type.Object({
          id: Type.String({ minLength: 1 }),
          assertion: Type.String({ minLength: 1 }),
        }),
      ),
      artifact: Type.Optional(ShownArtifactSchema),
    }),
  ),
  findings: Type.Array(FindingSchema),
  quotes: Type.Array(QuotedEvidenceSchema),
  notices: Type.Array(Type.String()),
  stoppedBy: Type.Optional(
    Type.Union([
      Type.Literal('turns'),
      Type.Literal('end_topic'),
      Type.Literal('ceiling'),
      Type.Literal('evaluator_failure'),
      Type.Literal('practice_outcome_rejected'),
    ]),
  ),
})

const AvailabilitySchema = Type.Union([
  Type.Literal('awaiting_answer'),
  Type.Literal('processing'),
  Type.Literal('closed'),
  Type.Literal('interrupted'),
])
function availabilityOf(closed: boolean, awaiting: boolean | undefined) {
  return closed
    ? ('closed' as const)
    : awaiting === undefined
      ? ('interrupted' as const)
      : awaiting
        ? ('awaiting_answer' as const)
        : ('processing' as const)
}

const SessionViewSchema = Type.Object({
  availability: AvailabilitySchema,
  sessionId: Type.String({ minLength: 1 }),
  session: Type.Union([SessionSchema, Type.Null()]),
  state: SessionStateSchema,
  round: Type.Union([RoundKindSchema, Type.Null()]),
  pressureLevel: PressureLevelSchema,
  transcript: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal('interviewer'), Type.Literal('candidate')]),
      text: Type.String(),
      attemptId: Type.String({ minLength: 1 }),
    }),
  ),
  findings: Type.Array(FindingSchema),
  quotes: Type.Array(QuotedEvidenceSchema),
  gaps: Type.Array(GapEntrySchema),
  claims: Type.Array(ClaimSchema),
  spans: Type.Array(SpanSchema),
  evidence: Type.Array(EvidenceSchema),
  invocations: Type.Array(InvocationRecordSchema),
  // Cost and tokens so the caller can check a ceiling promise — not a quality number.
  totals: Type.Object({ costUsd: Type.Number(), tokens: Type.Number() }),
  closed: Type.Union([Type.Object({ reason: Type.String() }), Type.Null()]),
})

const NO_CLAIMS = {
  error: 'no confirmed claims',
  detail:
    'this round cross-questions your résumé: add it under Résumé & projects (POST /claims, then ' +
    'POST /claims/:id/confirm). An interview round needs no résumé at all.',
}

async function askedTopics(store: EventStore): Promise<string[]> {
  const asked: string[] = []
  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    asked.push(...(view.session?.topicIds ?? []))
  }
  return asked
}

async function openSnapshot(
  store: EventStore,
  deps: ServerDeps,
  snapshotId: string | undefined,
): Promise<PinnedContext | undefined> {
  const entry = openPinned(await store.read(REPO_SESSION), snapshotId)
  if (entry === undefined) return undefined
  const repository = new GitRepository({ ids: deps.ids, clock: deps.clock })
  repository.register(entry.snapshot)
  return {
    snapshot: entry.snapshot,
    artifacts: entry.artifacts,
    evidence: entry.evidence,
    repository,
  }
}

export function sessionRoutes(deps: ServerDeps, host: SessionHost): FastifyPluginAsyncTypebox {
  const launches = new Map<string, Promise<unknown>>()
  const closures = new Map<string, Promise<unknown>>()
  return async (app) => {
    app.get(
      '/sessions',
      {
        schema: {
          summary: 'The current owner’s interviews, newest first, with their availability',
          tags: ['sessions'],
          response: {
            200: Type.Object({
              sessions: Type.Array(
                Type.Object({
                  session: SessionSchema,
                  answerCount: Type.Integer({ minimum: 0 }),
                  availability: AvailabilitySchema,
                }),
              ),
            }),
          },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)
        const sessions = []
        for (const sessionId of await store.listSessions()) {
          const view = replay(await store.read(sessionId))
          if (view.session === null) continue
          const live = host.get(sessionId, request.principal.ownerId)
          const availability = availabilityOf(view.closed !== null, live?.awaitingAnswer)
          sessions.push({
            session: view.session,
            answerCount: view.transcript.filter((entry) => entry.role === 'candidate').length,
            availability,
          })
        }
        sessions.sort(
          (left, right) =>
            right.session.startedAt.localeCompare(left.session.startedAt) ||
            right.session.id.localeCompare(left.session.id),
        )
        return { sessions }
      },
    )

    app.post(
      '/sessions',
      {
        schema: {
          summary: 'Start an interview and return the first question',
          tags: ['sessions'],
          body: Type.Object({
            roleId: Type.Optional(RoleIdSchema),
            topicIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
            claimIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
            gapId: Type.Optional(Type.String({ minLength: 1 })),
            snapshotId: Type.Optional(Type.String({ minLength: 1 })),
            storyId: Type.Optional(Type.String({ minLength: 1 })),
            storyRevision: Type.Optional(Type.Integer({ minimum: 1 })),
            mode: Type.Optional(ModeSchema),
            level: Type.Optional(LevelSchema),
            personaId: Type.Optional(PersonaIdSchema),
            pressureCeiling: Type.Optional(PressureLevelSchema),
            rounds: Type.Optional(Type.Array(RoundKindSchema, { minItems: 1 })),
            turnsPerRound: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
            drill: Type.Optional(Type.Boolean()),
          }),
          response: { 201: TurnUpdateSchema, 400: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const key = request.principal.ownerId
        const launch = (launches.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const body = request.body
            const store = deps.storeFor(request.principal)
            if ((body.storyId === undefined) !== (body.storyRevision === undefined))
              return reply.code(400).send({
                error: 'Select an exact story version',
                detail: 'Both story ID and revision are required.',
              })
            if (
              body.storyId !== undefined &&
              (body.gapId !== undefined || body.mode === 'drill' || body.mode === 'transfer')
            )
              return reply.code(400).send({
                error: 'Story rehearsal cannot be combined with a gap retest',
                detail: 'Start a separate behavioral interview.',
              })
            const story =
              body.storyId === undefined
                ? undefined
                : (await store.read('_stories')).flatMap((event) =>
                    event.kind === 'state_change' &&
                    event.payload.change === 'story_saved' &&
                    event.payload.story.id === body.storyId &&
                    event.payload.story.revision === body.storyRevision
                      ? [event.payload.story]
                      : [],
                  )[0]
            if (body.storyId !== undefined && story === undefined)
              return reply.code(400).send({
                error: 'Story version unavailable',
                detail: 'Choose a confirmed story owned by you.',
              })
            if (story !== undefined && !body.rounds?.includes('behavioral'))
              return reply.code(400).send({
                error: 'Story requires a behavioral round',
                detail: 'Add a behavioral round before starting.',
              })
            const history = await Promise.all(
              (await store.listSessions()).map(async (id) => replay(await store.read(id))),
            )
            const gaps = gapsAcrossViews(history)
            const target = body.gapId === undefined ? undefined : gaps.get(body.gapId)
            if (body.mode === 'drill' || body.mode === 'transfer' || body.gapId !== undefined) {
              if (
                !['drill', 'transfer'].includes(body.mode ?? '') ||
                target === undefined ||
                target.status !== (body.mode === 'transfer' ? 'drilled' : 'open')
              )
                return reply.code(400).send({
                  error: 'Select an owned open gap for a drill, or a drilled gap for Transfer',
                  detail: body.gapId ?? 'gapId is required',
                })
              if (target.topicId === undefined && target.claimId === undefined)
                return reply.code(400).send({
                  error: 'This gap has no available topic or claim target',
                  detail: target.id,
                })
              if (target.topicId !== undefined && topicById(target.topicId) === undefined)
                return reply
                  .code(400)
                  .send({ error: 'The target topic is unavailable', detail: target.topicId })
            }
            const targetTopic =
              target?.topicId === undefined ? undefined : topicById(target.topicId)
            if (
              target !== undefined &&
              history.some(
                (view) =>
                  view.session?.practiceGapId === target.id &&
                  host.get(view.session.id, request.principal.ownerId)?.awaitingAnswer,
              )
            )
              return reply.code(409).send({
                error: 'This gap already has an active practice session',
                detail: 'Finish or recover that attempt first.',
              })
            const exposed = new Set(
              history.flatMap((view) =>
                view.session?.practiceVariantId === undefined
                  ? []
                  : [`${view.session.practiceVariantId}@${view.session.practiceVariantVersion}`],
              ),
            )
            const variant =
              body.mode !== 'transfer' || targetTopic === undefined
                ? undefined
                : nextTransferVariant(targetTopic.id, exposed)
            if (body.mode === 'transfer' && variant === undefined)
              return reply.code(409).send({
                error: 'No unfamiliar authored Transfer variant is available',
                detail:
                  'The initial catalog covers database indexes; exhausted variants are never recycled as new.',
              })
            const roleId = body.roleId ?? DEFAULT_ROLE_ID
            const pack = rolePack(roleId)
            if (pack === undefined) {
              return reply.code(400).send({ error: 'no such role', detail: roleId })
            }

            const resolved = resolveInterview({
              roleId,
              rounds:
                target === undefined
                  ? body.rounds
                  : [
                      targetTopic === undefined
                        ? 'project_deep_dive'
                        : AREA_ROUND[targetTopic.area],
                    ],
              topicIds: targetTopic === undefined ? body.topicIds : [targetTopic.id],
            })
            if (!resolved.ok) {
              return reply.code(400).send(
                resolved.problem === 'unknown_topics'
                  ? { error: 'no such topic', detail: resolved.topicIds.join(', ') }
                  : {
                      error: 'a topic belongs to a round that was not requested',
                      detail: resolved.topics
                        .map((topic) => `${topic.id} is asked in ${AREA_ROUND[topic.area]}`)
                        .join(', '),
                    },
              )
            }
            const { rounds, topics } = resolved

            const claimSet = replay(await store.read(CLAIM_SET_SESSION))
            const confirmed = [...claimSet.claims.values()].filter((claim) =>
              claimSet.confirmedClaimIds.has(claim.id),
            )
            if (resolved.needsClaims && confirmed.length === 0)
              return reply.code(409).send(NO_CLAIMS)

            const wanted = target?.claimId === undefined ? body.claimIds : [target.claimId]
            const selected =
              wanted === undefined
                ? confirmed
                : confirmed.filter((claim) => wanted.includes(claim.id))
            if (wanted !== undefined && selected.length !== wanted.length) {
              const missing = wanted.filter((id) => !selected.some((claim) => claim.id === id))
              return reply.code(400).send({
                error: 'claim is not confirmed, or does not exist',
                detail: missing.join(', '),
              })
            }

            let pinned: PinnedContext | undefined
            if (resolved.needsSnapshot) {
              pinned = await openSnapshot(store, deps, body.snapshotId)
              if (pinned === undefined) {
                return reply.code(400).send({
                  error: 'pin a repository first',
                  detail:
                    body.snapshotId === undefined
                      ? 'a code walkthrough opens files from a pinned repository: POST /snapshots'
                      : `${body.snapshotId} is not a pinned snapshot, or it was deleted`,
                })
              }
            }

            const update = await host.start({
              principal: request.principal,
              claims: resolved.readsClaims ? selected : [],
              ...(story === undefined ? {} : { story }),
              rounds,
              role: roleId,
              ...(topics === undefined ? {} : { topics }),
              topicHistory: await askedTopics(store),
              ...(pinned === undefined ? {} : { pinned }),
              mode: body.mode ?? 'simulation',
              level:
                target === undefined
                  ? (body.level ?? pack.defaultLevel)
                  : (history
                      .flatMap((view) => view.findings)
                      .find((finding) => target.findingIds.includes(finding.id))?.level ?? 'mid'),
              // Gentle by default, as in `levelhead session`: a skeptic at full pressure is opted into.
              personaId: body.personaId ?? 'collaborator',
              pressureCeiling: (body.pressureCeiling ?? 1) as PressureLevel,
              turnsPerRound: target === undefined ? (body.turnsPerRound ?? 6) : 1,
              drill: target === undefined ? (body.drill ?? true) : false,
              ...(target === undefined
                ? { retrievals: dueForRetrieval([...gaps.values()], deps.clock.now(), 3) }
                : body.mode === 'transfer'
                  ? { transferGap: target, transferVariant: variant! }
                  : { drillGap: target }),
            })
            return reply.code(201).send({ ...update, findings: wireFindings(update.findings) })
          })
        launches.set(key, launch)
        try {
          return await launch
        } finally {
          if (launches.get(key) === launch) launches.delete(key)
        }
      },
    )

    app.post(
      '/sessions/:id/hints',
      {
        schema: {
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          body: Type.Object({ level: Type.Integer({ minimum: 1, maximum: 3 }) }),
          response: { 200: Type.Object({ text: Type.String() }), 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const live = host.get(request.params.id, request.principal.ownerId)
        const text = await live?.hint(request.body.level)
        if (text === undefined || text === null)
          return reply.code(409).send({
            error: 'No authored hint is available for this active drill',
            detail: 'Hints are only available for supported topic drills, never independent tests.',
          })
        return { text }
      },
    )

    app.post(
      '/sessions/:id/answers',
      {
        schema: {
          summary: 'Submit one answer and receive the next question and any findings',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          body: Type.Object({ text: Type.String() }),
          response: { 200: TurnUpdateSchema, 404: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const sessionId = request.params.id
        const live = host.get(sessionId, request.principal.ownerId)
        if (live === undefined) {
          // The log outlives the process; the suspended loop doesn't — distinguishes "no such
          // interview" (404) from "not resumable here" (409).
          const events = await deps.storeFor(request.principal).read(sessionId)
          if (events.length === 0) {
            return reply.code(404).send({ error: 'no such session', detail: sessionId })
          }
          return reply.code(409).send({
            error: 'session is not in progress on this server',
            detail: 'its log is still readable at GET /sessions/:id',
          })
        }
        if (!live.awaitingAnswer) {
          return reply.code(409).send({ error: 'session is not waiting for an answer' })
        }
        const update = await live.submit(request.body.text)
        return { ...update, findings: wireFindings(update.findings) }
      },
    )

    app.post(
      '/sessions/:id/close-interrupted',
      {
        schema: {
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: {
            200: Type.Object({ status: Type.Literal('closed'), reason: Type.String() }),
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const key = JSON.stringify([request.principal.ownerId, request.params.id])
        const closing = (closures.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const store = deps.storeFor(request.principal)
            const events = await store.read(request.params.id)
            const view = replay(events)
            if (view.session === null)
              return reply.code(404).send({ error: 'no such interview', detail: request.params.id })
            if (view.closed !== null)
              return { status: 'closed' as const, reason: view.closed.reason }
            if (host.get(request.params.id, request.principal.ownerId) !== undefined)
              return reply.code(409).send({
                error: 'This interview is still running',
                detail: 'This recovery action only ends an interrupted interview.',
              })
            const log = await SessionLog.open(
              { store, clock: deps.clock, ids: deps.ids },
              request.params.id,
            )
            await log.append('state_change', { change: 'session_closed', reason: 'interrupted' })
            return { status: 'closed' as const, reason: 'interrupted' }
          })
        closures.set(key, closing)
        try {
          return await closing
        } finally {
          if (closures.get(key) === closing) closures.delete(key)
        }
      },
    )

    app.get(
      '/sessions/:id',
      {
        schema: {
          summary: 'The session as replayed from its event log',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: { 200: SessionViewSchema, 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }

        // Transcript data comes from replay; availability describes this server process.
        const view = replay(events)
        return {
          availability: availabilityOf(
            view.closed !== null,
            host.get(request.params.id, request.principal.ownerId)?.awaitingAnswer,
          ),
          sessionId: view.sessionId,
          session: view.session,
          state: view.state,
          round: view.round,
          pressureLevel: view.pressureLevel,
          transcript: [...view.transcript],
          findings: wireFindings(view.findings),
          quotes: quotesFrom(view),
          gaps: [...view.gaps.values()],
          claims: [...view.claims.values()],
          spans: [...view.spans.values()],
          evidence: [...view.evidence.values()],
          invocations: [...view.invocations],
          totals: view.totals,
          closed: view.closed,
        }
      },
    )

    app.get(
      '/sessions/:id/events',
      {
        schema: {
          summary: 'The raw append-only event log, in seq order',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: { 200: Type.Array(EventSchema), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        return events
      },
    )
  }
}
