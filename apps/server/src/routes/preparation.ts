import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { PreparationGoalsSchema, PreparationSelectionSchema, untrusted } from '@levelhead/contracts'
import { extractRequiredTerms, openPinned, replay, rolePack, SessionLog } from '@levelhead/core'
import type { PreparationGoals } from '@levelhead/contracts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const PREPARATION = '_preparation'
const GOALS = '_preparation_goals'
const ResponseSchema = Type.Object({
  selection: Type.Union([PreparationSelectionSchema, Type.Null()]),
})

function goalsResult(goals: PreparationGoals | null) {
  return {
    goals,
    suggestedTerms: goals?.jobDescription
      ? extractRequiredTerms(untrusted(goals.jobDescription), 5).map((entry) => entry.term)
      : [],
  }
}

export function preparationRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const writes = new Map<string, Promise<unknown>>()
  return async (app) => {
    const goalsResponse = Type.Object({
      goals: Type.Union([PreparationGoalsSchema, Type.Null()]),
      suggestedTerms: Type.Array(Type.String()),
    })
    app.get(
      '/preparation/goals',
      { schema: { response: { 200: goalsResponse } } },
      async (request) => {
        const events = await deps.storeFor(request.principal).read(GOALS)
        const saved = events
          .filter(
            (event) =>
              event.kind === 'state_change' && event.payload.change === 'preparation_goals_saved',
          )
          .at(-1)
        return goalsResult(
          saved?.kind === 'state_change' && saved.payload.change === 'preparation_goals_saved'
            ? saved.payload.goals
            : null,
        )
      },
    )
    app.post(
      '/preparation/goals',
      {
        schema: {
          body: PreparationGoalsSchema,
          response: { 200: goalsResponse, 400: ErrorSchema },
        },
      },
      async (request, reply) => {
        if (rolePack(request.body.roleId) === undefined)
          return reply.code(400).send({ error: 'Unknown role', detail: request.body.roleId })
        const key = `${request.principal.ownerId}:goals`
        const previous = writes.get(key) ?? Promise.resolve()
        const write = previous
          .catch(() => {})
          .then(async () => {
            const log = await SessionLog.open(
              { store: deps.storeFor(request.principal), clock: deps.clock, ids: deps.ids },
              GOALS,
            )
            await log.append('state_change', {
              change: 'preparation_goals_saved',
              goals: request.body,
            })
            return goalsResult(request.body)
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
      '/preparation',
      { schema: { tags: ['preparation'], response: { 200: ResponseSchema } } },
      async (request) => {
        const events = await deps.storeFor(request.principal).read(PREPARATION)
        const saved = events
          .filter(
            (event) =>
              event.kind === 'state_change' && event.payload.change === 'preparation_saved',
          )
          .at(-1)
        return {
          selection:
            saved?.kind === 'state_change' && saved.payload.change === 'preparation_saved'
              ? saved.payload.selection
              : null,
        }
      },
    )
    app.post(
      '/preparation',
      {
        schema: {
          tags: ['preparation'],
          body: PreparationSelectionSchema,
          response: { 200: ResponseSchema, 400: ErrorSchema },
        },
      },
      async (request, reply) => {
        const key = request.principal.ownerId
        const previous = writes.get(key) ?? Promise.resolve()
        const write = previous
          .catch(() => {})
          .then(async () => {
            const store = deps.storeFor(request.principal)
            const claims = replay(await store.read(CLAIM_SET_SESSION))
            if (request.body.claimIds.some((id) => !claims.confirmedClaimIds.has(id))) {
              return reply.code(400).send({
                error: 'Select confirmed claims belonging to this owner',
                detail: 'Refresh preparation and select available material.',
              })
            }
            if (
              request.body.snapshotId !== undefined &&
              openPinned(await store.read(REPO_SESSION), request.body.snapshotId) === undefined
            ) {
              return reply.code(400).send({
                error: 'Selected snapshot is unavailable or deleted',
                detail: 'Select an available pinned project.',
              })
            }
            const log = await SessionLog.open(
              { store, clock: deps.clock, ids: deps.ids },
              PREPARATION,
            )
            await log.append('state_change', {
              change: 'preparation_saved',
              selection: request.body,
            })
            return { selection: request.body }
          })
        writes.set(key, write)
        try {
          return await write
        } finally {
          if (writes.get(key) === write) writes.delete(key)
        }
      },
    )
  }
}
