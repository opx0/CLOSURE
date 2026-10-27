import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { StorySchema } from '@levelhead/contracts'
import { SessionLog } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const STORY_LOG = '_stories'
const SaveStorySchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    previousRevision: Type.Integer({ minimum: 0 }),
    situation: Type.String({ minLength: 1, maxLength: 4000 }),
    action: Type.String({ minLength: 1, maxLength: 4000 }),
    result: Type.String({ minLength: 1, maxLength: 4000 }),
    confirmed: Type.Literal(true),
  },
  { additionalProperties: false },
)

export function storiesRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  const writes = new Map<string, Promise<unknown>>()
  return async (app) => {
    app.get(
      '/stories',
      {
        schema: {
          tags: ['stories'],
          response: { 200: Type.Object({ stories: Type.Array(StorySchema) }) },
        },
      },
      async (request) => {
        const events = await deps.storeFor(request.principal).read(STORY_LOG)
        return {
          stories: events.flatMap((event) =>
            event.kind === 'state_change' && event.payload.change === 'story_saved'
              ? [event.payload.story]
              : [],
          ),
        }
      },
    )
    app.post(
      '/stories',
      {
        schema: {
          tags: ['stories'],
          body: SaveStorySchema,
          response: { 200: StorySchema, 400: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const key = request.principal.ownerId
        const write = (writes.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const store = deps.storeFor(request.principal)
            const events = await store.read(STORY_LOG)
            const previous = events
              .flatMap((event) =>
                event.kind === 'state_change' &&
                event.payload.change === 'story_saved' &&
                event.payload.story.id === request.body.id
                  ? [event.payload.story]
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
                .send({ error: 'Story version conflict', detail: 'Reload before editing.' })
            if (
              [request.body.situation, request.body.action, request.body.result].some(
                (value) => !value.trim(),
              )
            )
              return reply.code(400).send({
                error: 'Story fields cannot be blank',
                detail: 'Describe the situation, your action and the result.',
              })
            const story = {
              id: request.body.id ?? deps.ids.next('story'),
              revision: request.body.previousRevision + 1,
              situation: request.body.situation.trim(),
              action: request.body.action.trim(),
              result: request.body.result.trim(),
              confirmed: true as const,
            }
            const log = await SessionLog.open(
              { store, clock: deps.clock, ids: deps.ids },
              STORY_LOG,
            )
            await log.append('state_change', { change: 'story_saved', story })
            return story
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
