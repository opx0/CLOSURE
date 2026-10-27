import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { GapEntrySchema, RoundKindSchema } from '@levelhead/contracts'
import { planNextSession, replay, gapsAcrossViews } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'

const PlannedWorkSchema = Type.Object({
  gap: GapEntrySchema,
  reason: Type.Union([
    Type.Literal('drill_the_open_gap'),
    Type.Literal('transfer_the_drilled_gap'),
    Type.Literal('retrieve_the_closed_gap'),
    Type.Literal('restate_the_unverified'),
  ]),
  dueAt: Type.String({ format: 'date-time' }),
})

// The longitudinal half of §4.5: what is due, when, and why — never a readiness number derived
// from it.
export function scheduleRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
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

        return planNextSession({
          gaps: [...gaps.values()],
          now: deps.clock.now(),
          horizonDays: request.query.horizonDays ?? 7,
          retrievalLimit: 3,
        })
      },
    )
  }
}
