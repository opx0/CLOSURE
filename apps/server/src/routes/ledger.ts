import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { FindingSchema, GapEntrySchema } from '@levelhead/contracts'
import { replay, gapsAcrossViews, practiceActionForGap, spanViolations } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import {
  ErrorSchema,
  QuotedEvidenceSchema,
  SessionIdParamsSchema,
  quotesFrom,
  wireFindings,
} from './shared.ts'

const ViolationSchema = Type.Object({
  spanId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1 }),
})

export function ledgerRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/ledger',
      {
        schema: {
          summary: 'The gap ledger, across every session (§4.6)',
          tags: ['ledger'],
          response: {
            200: Type.Object({
              gaps: Type.Array(GapEntrySchema),
              practice: Type.Array(
                Type.Object({
                  gapId: Type.String({ minLength: 1 }),
                  nextAction: Type.Union([
                    Type.Literal('drill'),
                    Type.Literal('transfer'),
                    Type.Literal('unavailable'),
                  ]),
                }),
              ),
              quotes: Type.Array(QuotedEvidenceSchema),
              // §4.6's four columns plus a broken-build count of unresolved citations — not a score.
              unresolvedCitations: Type.Integer({ minimum: 0 }),
            }),
          },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)
        const views: ReturnType<typeof replay>[] = []
        const quotes = new Map<string, string>()
        let unresolvedCitations = 0

        // Gaps cross sessions, so all are replayed; session order isn't chronological, so the most
        // recently touched row wins, not the last one read.
        for (const sessionId of await store.listSessions()) {
          const view = replay(await store.read(sessionId))
          views.push(view)
          for (const quote of quotesFrom(view)) quotes.set(quote.evidenceId, quote.quoted)
          unresolvedCitations += spanViolations(view.spans.values(), view.sources).length
        }

        const gaps = [...gapsAcrossViews(views).values()]
        const exposedVariants = new Set(
          views.flatMap((view) =>
            view.session?.practiceVariantId === undefined
              ? []
              : [`${view.session.practiceVariantId}@${view.session.practiceVariantVersion}`],
          ),
        )
        const claimSet = replay(await store.read(CLAIM_SET_SESSION))
        const confirmedClaims = new Map(
          [...claimSet.claims].filter(([id]) => claimSet.confirmedClaimIds.has(id)),
        )
        return {
          gaps,
          practice: gaps.map((gap) => ({
            gapId: gap.id,
            nextAction: practiceActionForGap(gap, { exposedVariants, confirmedClaims }),
          })),
          quotes: [...quotes].map(([evidenceId, quoted]) => ({ evidenceId, quoted })),
          unresolvedCitations,
        }
      },
    )

    app.get(
      '/sessions/:id/replay',
      {
        schema: {
          summary: 'Re-fold the log and re-check every citation byte-for-byte',
          tags: ['ledger'],
          params: SessionIdParamsSchema,
          response: {
            200: Type.Object({
              sessionId: Type.String({ minLength: 1 }),
              events: Type.Integer({ minimum: 1 }),
              spansChecked: Type.Integer({ minimum: 0 }),
              transcript: Type.Array(
                Type.Object({
                  role: Type.Union([Type.Literal('interviewer'), Type.Literal('candidate')]),
                  text: Type.String(),
                  attemptId: Type.String({ minLength: 1 }),
                }),
              ),
              findings: Type.Array(FindingSchema),
              quotes: Type.Array(QuotedEvidenceSchema),
            }),
            404: ErrorSchema,
            500: Type.Object({
              error: Type.String(),
              violations: Type.Array(ViolationSchema),
            }),
          },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }

        const view = replay(events)
        const violations = spanViolations(view.spans.values(), view.sources)
        // An unresolvable citation is a bug, not a score — this fails the request rather than
        // returning a `citationsResolve: false` field that would let it degrade quietly.
        if (violations.length > 0) {
          return reply.code(500).send({ error: 'citations do not resolve', violations })
        }

        return {
          sessionId: view.sessionId,
          events: events.length,
          spansChecked: view.spans.size,
          transcript: [...view.transcript],
          findings: wireFindings(view.findings),
          quotes: quotesFrom(view),
        }
      },
    )
  }
}
