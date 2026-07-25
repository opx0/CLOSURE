import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { widenFindings } from '@closer/contracts'
import type { SessionHost } from '../session-host.ts'
import { SessionIdParamsSchema } from './shared.ts'

const KEEPALIVE_MS = 15_000

// ADR-018: server → client only, so SSE rather than a socket. The stream is a view of progress; the
// event log is the record, and every frame here was written there first.
export function streamRoutes(host: SessionHost): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/sessions/:id/stream',
      {
        schema: {
          summary: 'Server-sent turn updates for an interview in progress',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: {
            404: Type.Object({ error: Type.String(), detail: Type.Optional(Type.String()) }),
          },
        },
      },
      async (request, reply) => {
        const live = host.get(request.params.id, request.principal.ownerId)
        if (live === undefined) {
          return reply
            .code(404)
            .send({ error: 'no session in progress', detail: request.params.id })
        }

        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        reply.raw.write(
          `event: open\ndata: ${JSON.stringify({ sessionId: request.params.id })}\n\n`,
        )

        const unsubscribe = live.subscribe((update) => {
          const payload = JSON.stringify({ ...update, findings: widenFindings(update.findings) })
          reply.raw.write(`event: turn\ndata: ${payload}\n\n`)
          if (update.status === 'closed') reply.raw.end()
        })

        const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), KEEPALIVE_MS)
        request.raw.on('close', () => {
          clearInterval(keepalive)
          unsubscribe()
        })
        return reply
      },
    )
  }
}
