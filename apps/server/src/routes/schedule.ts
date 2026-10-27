import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  GapEntrySchema,
  RoundKindSchema,
  RoleIdSchema,
  LevelSchema,
  LEVEL_ORDER,
} from '@levelhead/contracts'
import {
  planNextSession,
  replay,
  gapsAcrossViews,
  topicById,
  nextTransferVariant,
  SessionLog,
  TOPICS,
  AREA_ROUND,
  topicSuitsRole,
} from '@levelhead/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const PLAN_SESSION = '_practice_plan'
const SelectionSchema = Type.Object({
  gapId: Type.String({ minLength: 1 }),
  mode: Type.Union([Type.Literal('drill'), Type.Literal('transfer')]),
})

const PlannedWorkSchema = Type.Object({
  gap: GapEntrySchema,
  reason: Type.Union([
    Type.Literal('drill_the_open_gap'),
    Type.Literal('transfer_the_drilled_gap'),
    Type.Literal('retrieve_the_closed_gap'),
    Type.Literal('restate_the_unverified'),
  ]),
  dueAt: Type.String({ format: 'date-time' }),
  action: Type.Union([
    Type.Literal('drill'),
    Type.Literal('transfer'),
    Type.Literal('unavailable'),
  ]),
})

// The longitudinal half of §4.5: what is due, when, and why — never a readiness number derived
// from it.
export function scheduleRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const writes = new Map<string, Promise<unknown>>()
  return async (app) => {
    app.post(
      '/schedule/plan',
      {
        schema: { body: SelectionSchema, response: { 200: SelectionSchema, 400: ErrorSchema } },
      },
      async (request, reply) => {
        const key = request.principal.ownerId
        const write = (writes.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const store = deps.storeFor(request.principal)
            const views = await Promise.all(
              (await store.listSessions()).map(async (id) => replay(await store.read(id))),
            )
            const gap = gapsAcrossViews(views).get(request.body.gapId)
            const claims = replay(await store.read(CLAIM_SET_SESSION))
            const exposed = new Set(
              views.flatMap((view) =>
                view.session?.practiceVariantId === undefined
                  ? []
                  : [`${view.session.practiceVariantId}@${view.session.practiceVariantVersion}`],
              ),
            )
            const topic = gap?.topicId === undefined ? undefined : topicById(gap.topicId)
            const claimAvailable =
              gap?.claimId !== undefined && claims.confirmedClaimIds.has(gap.claimId)
            const allowed =
              request.body.mode === 'drill'
                ? gap?.status === 'open' && (topic !== undefined || claimAvailable)
                : gap?.status === 'drilled' &&
                  topic !== undefined &&
                  nextTransferVariant(topic.id, exposed) !== undefined
            if (!allowed)
              return reply.code(400).send({
                error: 'Practice target is unavailable',
                detail: 'Refresh the schedule and choose an eligible target.',
              })
            const log = await SessionLog.open(
              { store, clock: deps.clock, ids: deps.ids },
              PLAN_SESSION,
            )
            await log.append('state_change', { change: 'practice_plan_saved', ...request.body })
            return request.body
          })
        writes.set(key, write)
        try {
          return await write
        } finally {
          if (writes.get(key) === write) writes.delete(key)
        }
      },
    )
    app.get(
      '/schedule',
      {
        schema: {
          summary: 'What is due across every session, and the rounds that would cover it',
          tags: ['schedule'],
          querystring: Type.Object({
            horizonDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, default: 7 })),
          }),
          response: {
            200: Type.Object({
              suggestedRounds: Type.Array(RoundKindSchema),
              work: Type.Array(PlannedWorkSchema),
              // Due retrievals are listed for the operator, never announced to the candidate
              // mid-session (§4.5).
              retrievals: Type.Array(GapEntrySchema),
              nothingDue: Type.Boolean(),
              horizonEndsAt: Type.String({ format: 'date-time' }),
              saved: Type.Union([SelectionSchema, Type.Null()]),
              coverage: Type.Union([
                Type.Object({
                  id: Type.String(),
                  title: Type.String(),
                  round: RoundKindSchema,
                  roleId: RoleIdSchema,
                  level: LevelSchema,
                }),
                Type.Null(),
              ]),
              availableMinutes: Type.Union([Type.Integer(), Type.Null()]),
            }),
          },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)
        const views = await Promise.all(
          (await store.listSessions()).map(async (id) => replay(await store.read(id))),
        )
        const gaps = gapsAcrossViews(views)

        const plan = planNextSession({
          gaps: [...gaps.values()],
          now: deps.clock.now(),
          horizonDays: request.query.horizonDays ?? 7,
          retrievalLimit: 3,
        })
        const claims = replay(await store.read(CLAIM_SET_SESSION))
        const exposed = new Set(
          views.flatMap((view) =>
            view.session?.practiceVariantId === undefined
              ? []
              : [`${view.session.practiceVariantId}@${view.session.practiceVariantVersion}`],
          ),
        )
        const savedEvent = (await store.read(PLAN_SESSION))
          .filter(
            (event) =>
              event.kind === 'state_change' && event.payload.change === 'practice_plan_saved',
          )
          .at(-1)
        const saved =
          savedEvent?.kind === 'state_change' && savedEvent.payload.change === 'practice_plan_saved'
            ? { gapId: savedEvent.payload.gapId, mode: savedEvent.payload.mode }
            : null
        const goalsEvent = (await store.read('_preparation_goals'))
          .filter(
            (event) =>
              event.kind === 'state_change' && event.payload.change === 'preparation_goals_saved',
          )
          .at(-1)
        const goals =
          goalsEvent?.kind === 'state_change' &&
          goalsEvent.payload.change === 'preparation_goals_saved'
            ? goalsEvent.payload.goals
            : undefined
        const roleId = goals?.roleId ?? 'backend_services'
        const level = goals?.level ?? 'junior'
        const seenTopics = new Set(
          views.flatMap((view) =>
            [...view.attempts.values()].flatMap((attempt) =>
              attempt.topicId === undefined ? [] : [attempt.topicId],
            ),
          ),
        )
        const uncovered = TOPICS.find(
          (topic) =>
            AREA_ROUND[topic.area] === 'cs_fundamentals' &&
            topicSuitsRole(topic, roleId) &&
            LEVEL_ORDER.indexOf(topic.minLevel) <= LEVEL_ORDER.indexOf(level) &&
            !seenTopics.has(topic.id),
        )
        return {
          ...plan,
          saved,
          coverage:
            uncovered === undefined
              ? null
              : {
                  id: uncovered.id,
                  title: uncovered.title,
                  round: AREA_ROUND[uncovered.area],
                  roleId,
                  level,
                },
          availableMinutes: goals?.availableMinutes ?? null,
          work: plan.work.map((entry) => {
            const topic = entry.gap.topicId === undefined ? undefined : topicById(entry.gap.topicId)
            const claimAvailable =
              entry.gap.claimId !== undefined && claims.confirmedClaimIds.has(entry.gap.claimId)
            const action =
              entry.gap.status === 'open' && (topic !== undefined || claimAvailable)
                ? ('drill' as const)
                : entry.gap.status === 'drilled' &&
                    topic !== undefined &&
                    nextTransferVariant(topic.id, exposed) !== undefined
                  ? ('transfer' as const)
                  : ('unavailable' as const)
            return { ...entry, action }
          }),
        }
      },
    )
  }
}
