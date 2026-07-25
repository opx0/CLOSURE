import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { FindingSchema } from '@closer/contracts'
import type { Finding } from '@closer/contracts'
import { availabilitySummary, replay } from '@closer/core'
import type { ServerDeps } from '../deps.ts'
import { QuotedEvidenceSchema, wireFindings } from './shared.ts'

interface Attempted {
  at: string
  sessionId: string
  finding: Finding
  quoted?: string
}

// §4.6's Review, over HTTP: attempts side by side, in evidence, with no aggregate over them.
export function reviewRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/review',
      {
        schema: {
          summary: 'Every judgment about one claim or competency, oldest first, with its quotes',
          tags: ['review'],
          querystring: Type.Object({
            subject: Type.Optional(Type.String({ minLength: 1 })),
          }),
          response: {
            200: Type.Object({
              subjects: Type.Array(
                Type.Object({
                  subject: Type.String({ minLength: 1 }),
                  attempts: Type.Array(
                    Type.Object({
                      at: Type.String(),
                      sessionId: Type.String({ minLength: 1 }),
                      finding: FindingSchema,
                      quoted: Type.Optional(Type.String()),
                    }),
                  ),
                }),
              ),
              citations: Type.Object({
                resolved: Type.Integer({ minimum: 0 }),
                unresolvable: Type.Integer({ minimum: 0 }),
                snapshotDeleted: Type.Integer({ minimum: 0 }),
                notInThisSession: Type.Integer({ minimum: 0 }),
              }),
              quotes: Type.Array(QuotedEvidenceSchema),
            }),
          },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)
        const history = new Map<string, Attempted[]>()
        const quotes = new Map<string, string>()
        const citations = {
          resolved: 0,
          unresolvable: 0,
          snapshotDeleted: 0,
          notInThisSession: 0,
        }

        for (const sessionId of await store.listSessions()) {
          const view = replay(await store.read(sessionId))
          const startedAt = view.session?.startedAt ?? ''
          const summary = availabilitySummary(view)
          citations.resolved += summary.resolved
          citations.unresolvable += summary.unresolvable
          citations.snapshotDeleted += summary.snapshotDeleted
          citations.notInThisSession += summary.notInThisSession

          for (const link of view.evidence.values()) {
            if (link.target.kind !== 'span') continue
            const span = view.spans.get(link.target.spanId)
            if (span !== undefined) quotes.set(link.id, span.quoted)
          }

          for (const finding of view.findings) {
            const subject =
              finding.kind === 'claim' || finding.kind === 'claim_abstained'
                ? finding.claimId
                : finding.competency
            if (request.query.subject !== undefined && subject !== request.query.subject) continue
            const rows = history.get(subject) ?? []
            const spanId = finding.transcriptSpanIds[0]
            const quoted = view.spans.get(spanId)?.quoted
            rows.push({
              at: startedAt,
              sessionId,
              finding,
              ...(quoted === undefined ? {} : { quoted }),
            })
            history.set(subject, rows)
          }
        }

        return {
          subjects: [...history].map(([subject, rows]) => ({
            subject,
            attempts: rows
              .sort((left, right) => left.at.localeCompare(right.at))
              .map((row) => ({
                at: row.at,
                sessionId: row.sessionId,
                finding: wireFindings([row.finding])[0] as never,
                ...(row.quoted === undefined ? {} : { quoted: row.quoted }),
              })),
          })),
          citations,
          quotes: [...quotes].map(([evidenceId, quoted]) => ({ evidenceId, quoted })),
        }
      },
    )
  }
}
