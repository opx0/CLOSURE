import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { DesignSchema } from '@levelhead/contracts'
import { SessionLog } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

export const DESIGN_LOG = '_designs'
const SaveDesignSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    previousRevision: Type.Integer({ minimum: 0 }),
    ...Type.Omit(DesignSchema, ['id', 'revision']).properties,
  },
  { additionalProperties: false },
)

export function designRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const writes = new Map<string, Promise<unknown>>()
  return async (app) => {
    app.get(
      '/designs',
      {
        schema: {
          tags: ['designs'],
          response: { 200: Type.Object({ designs: Type.Array(DesignSchema) }) },
        },
      },
      async (request) => ({
        designs: (await deps.storeFor(request.principal).read(DESIGN_LOG)).flatMap((event) =>
          event.kind === 'state_change' && event.payload.change === 'design_saved'
            ? [event.payload.design]
            : [],
        ),
      }),
    )
    app.post(
      '/designs',
      {
        schema: {
          tags: ['designs'],
          body: SaveDesignSchema,
          response: { 200: DesignSchema, 400: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const key = request.principal.ownerId
        const write = (writes.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const store = deps.storeFor(request.principal)
            const events = await store.read(DESIGN_LOG)
            const previous = events
              .flatMap((event) =>
                event.kind === 'state_change' &&
                event.payload.change === 'design_saved' &&
                event.payload.design.id === request.body.id
                  ? [event.payload.design]
                  : [],
              )
              .at(-1)
            if (
              request.body.id === undefined
                ? request.body.previousRevision !== 0
                : previous === undefined || previous.revision !== request.body.previousRevision
            )
              return reply
                .code(409)
                .send({ error: 'Design version conflict', detail: 'Reload before editing.' })
            if (
              !request.body.title.trim() ||
              !request.body.requirements.trim() ||
              !request.body.constraint.trim()
            )
              return reply
                .code(400)
                .send({ error: 'Title, requirements and constraint are required' })
            const design = {
              id: request.body.id ?? deps.ids.next('design'),
              revision: request.body.previousRevision + 1,
              title: request.body.title.trim(),
              requirements: request.body.requirements.trim(),
              estimates: request.body.estimates.trim(),
              api: request.body.api.trim(),
              dataModel: request.body.dataModel.trim(),
              diagram: request.body.diagram.trim(),
              constraint: request.body.constraint.trim(),
            }
            const log = await SessionLog.open(
              { store, clock: deps.clock, ids: deps.ids },
              DESIGN_LOG,
            )
            await log.append('state_change', { change: 'design_saved', design })
            return design
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
