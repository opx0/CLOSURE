import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { LOCAL_PRINCIPAL, type Principal } from '@closer/contracts'
import {
  CORRELATION_HEADER,
  HTTP_DURATION,
  HTTP_REQUESTS,
  correlationIdFrom,
  metrics,
} from '@closer/observability'
import { Principals } from '../principal.ts'

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal
    correlationId: string
    startedAt: number
  }
}

const PUBLIC_PATHS = new Set(['/health', '/metrics', '/openapi.json', '/', '/demo/token'])

export interface ContextOptions {
  tokens: string
  demoMode: boolean
}

// Identity, correlation and request metrics in one place. Route handlers stay thin (STACK §5) and
// never read a header themselves.
export const contextPlugin = fp(
  async (app: FastifyInstance, options: ContextOptions) => {
    const principals = new Principals(options.tokens)

    // Showcase tokens are minted at runtime and live only as long as the process, so they are never
    // in the configured list and are never written into one.
    const demoTokens = new Map<string, string>()
    app.decorate('demoTokens', demoTokens)

    // Fastify refuses a shared object as a request decorator, and rightly: one instance handed to
    // every request is one caller's identity leaking into the next. Held per request instead.
    const identities = new WeakMap<FastifyRequest, Principal>()
    app.decorateRequest('principal', {
      getter(this: FastifyRequest): Principal {
        return identities.get(this) ?? LOCAL_PRINCIPAL
      },
      setter(this: FastifyRequest, value: Principal): void {
        identities.set(this, value)
      },
    })
    app.decorateRequest('correlationId', '')
    app.decorateRequest('startedAt', 0)

    app.addHook('onRequest', async (request, reply) => {
      request.startedAt = Date.now()
      request.correlationId = correlationIdFrom(request.headers[CORRELATION_HEADER])
      reply.header(CORRELATION_HEADER, request.correlationId)

      const offered = request.headers.authorization
      const demoOwner =
        options.demoMode && offered?.startsWith('Bearer ') === true
          ? demoTokens.get(offered.slice('Bearer '.length).trim())
          : undefined
      if (demoOwner !== undefined) {
        request.principal = { ownerId: demoOwner, role: 'showcase', label: 'showcase visitor' }
        return
      }

      const resolved = principals.resolve(offered)
      if (resolved === null) {
        if (PUBLIC_PATHS.has(request.url.split('?')[0] ?? '')) {
          request.principal = LOCAL_PRINCIPAL
          return
        }
        await reply.code(401).send({
          error: 'unauthorized',
          detail: 'send Authorization: Bearer <token>',
        })
        return
      }
      request.principal = resolved
    })

    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? 'unmatched'
      metrics.counter(HTTP_REQUESTS, 'HTTP requests by route and status', {
        route,
        method: request.method,
        status: String(reply.statusCode),
      })
      metrics.observe(
        HTTP_DURATION,
        'HTTP request duration in seconds',
        (Date.now() - request.startedAt) / 1_000,
        { route, method: request.method },
      )
    })
  },
  { name: 'closer-context' },
)
