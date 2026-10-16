import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { FindingSchema } from '@levelhead/contracts'
import type { Finding } from '@levelhead/contracts'
import { availabilitySummary, replay, topicById } from '@levelhead/core'
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
          summary:
            'Every judgment about one topic, file or résumé claim, oldest first, with its quotes',
          tags: ['review'],
          querystring: Type.Object({
            subject: Type.Optional(Type.String({ minLength: 1 })),
          }),
          response: {
            200: Type.Object({
              subjects: Type.Array(
                Type.Object({
                  subject: Type.String({ minLength: 1 }),
                  // The topic, file or résumé line the attempts were about, in words.
                  label: Type.String({ minLength: 1 }),
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
        const labels = new Map<string, string>()
        const quotes = new Map<string, string>()
        const citations = {
          resolved: 0,
          unresolvable: 0,
          snapshotDeleted: 0,
          notInThisSession: 0,
        }

        for (const sessionId of await store.listSessions()) {
          const events = await store.read(sessionId)
          const view = replay(events)
          for (const claim of view.claims.values()) labels.set(claim.id, claim.assertion)
          for (const artifact of view.artifacts.values()) {
            labels.set(
              artifact.id,
              artifact.symbol === undefined
                ? artifact.path
                : `${artifact.path} · ${artifact.symbol}`,
            )
          }
          const askedAbout = new Map<string, string>()
          for (const event of events) {
            if (event.kind !== 'policy_action') continue
            const { attemptId, topicId, artifactId, claimId } = event.payload
            const about = topicId ?? artifactId ?? claimId
            if (about !== undefined) askedAbout.set(attemptId, about)
            if (topicId !== undefined) labels.set(topicId, topicById(topicId)?.title ?? topicId)
          }
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

          // Grouped by what was asked, so two answers side by side are answers to the same thing.
          // Composure belongs to the candidate rather than to any one question.
          for (const finding of view.findings) {
            const subject =
              finding.kind === 'claim' || finding.kind === 'claim_abstained'
                ? finding.claimId
                : finding.kind === 'composure'
                  ? 'composure'
                  : (askedAbout.get(finding.attemptId) ?? finding.competency)
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
            label: labels.get(subject) ?? subject.replace(/_/g, ' '),
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
