import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { PreparationSelectionSchema } from '@levelhead/contracts'
import { openPinned, replay, SessionLog } from '@levelhead/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const PREPARATION = '_preparation'
const ResponseSchema = Type.Object({
  selection: Type.Union([PreparationSelectionSchema, Type.Null()]),
})

export function preparationRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const writes = new Map<string, Promise<unknown>>()
  return async (app) => {
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
