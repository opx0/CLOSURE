import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { FindingSchema } from '@levelhead/contracts'
import type { Finding } from '@levelhead/contracts'
import { availabilitySummary, replay, topicById, spanViolations } from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { QuotedEvidenceSchema, wireFindings } from './shared.ts'

interface Attempted {
  at: string
  sessionId: string
  finding: Finding
  quoted?: string
  practice: 'coached' | 'transfer' | 'retrieval' | 'unclassified'
  superseded: boolean
  evaluator: { model: string; prompt: string; rubric: string } | null
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
                      practice: Type.Union([
                        Type.Literal('coached'),
                        Type.Literal('transfer'),
                        Type.Literal('retrieval'),
                        Type.Literal('unclassified'),
                      ]),
                      superseded: Type.Boolean(),
                      evaluator: Type.Union([
                        Type.Object({
                          model: Type.String(),
                          prompt: Type.String(),
                          rubric: Type.String(),
                        }),
                        Type.Null(),
                      ]),
                      versionChanged: Type.Boolean(),
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
        const deletedSnapshots = replay(await store.read(REPO_SESSION)).tombstones
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
          if (view.session === null || (view.session.mode === 'simulation' && view.closed === null))
            continue
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
          const evaluations = new Map<string, { model: string; prompt: string; rubric: string }>()
          const practices = new Map<string, 'coached' | 'transfer' | 'retrieval'>()
          const assisted = new Set<string>()
          for (const event of events) {
            if (event.kind === 'evaluation') {
              for (const finding of event.payload.findings)
                evaluations.set(finding.id, {
                  model: event.payload.invocation.modelAlias,
                  prompt: `${event.payload.invocation.promptId}@${event.payload.invocation.promptVersion}:${event.payload.invocation.promptHash}`,
                  rubric: JSON.stringify(view.session?.rubricSet ?? null),
                })
            }
            if (event.kind === 'state_change' && event.payload.change === 'practice_outcome')
              practices.set(
                event.payload.attemptId,
                event.payload.kind === 'drill' ? 'coached' : event.payload.kind,
              )
            if (event.kind === 'state_change' && event.payload.change === 'practice_assistance')
              assisted.add(event.payload.attemptId)
            if (event.kind !== 'policy_action') continue
            const { attemptId, topicId, artifactId, claimId } = event.payload
            const about = topicId ?? artifactId ?? claimId
            if (about !== undefined) askedAbout.set(attemptId, about)
            if (topicId !== undefined) labels.set(topicId, topicById(topicId)?.title ?? topicId)
          }
          const startedAt = view.session?.startedAt ?? ''
          const summary = availabilitySummary({
            ...view,
            tombstones: [...view.tombstones, ...deletedSnapshots],
          })
          citations.resolved += summary.resolved
          citations.unresolvable += summary.unresolvable
          citations.snapshotDeleted += summary.snapshotDeleted
          citations.notInThisSession += summary.notInThisSession

          for (const link of view.evidence.values()) {
            if (link.target.kind !== 'span') continue
            const span = view.spans.get(link.target.spanId)
            if (span !== undefined && spanViolations([span], view.sources).length === 0)
              quotes.set(link.id, span.quoted)
          }

          // Grouped by what was asked, so two answers side by side are answers to the same thing.
          // Composure belongs to the candidate rather than to any one question.
          for (const finding of view.historicalFindings ?? view.findings) {
            const subject =
              finding.kind === 'claim' || finding.kind === 'claim_abstained'
                ? finding.claimId
                : finding.kind === 'composure'
                  ? 'composure'
                  : (askedAbout.get(finding.attemptId) ?? finding.competency)
            if (request.query.subject !== undefined && subject !== request.query.subject) continue
            const rows = history.get(subject) ?? []
            const spanId = finding.transcriptSpanIds[0]
            const span = view.spans.get(spanId)
            const quoted =
              span !== undefined && spanViolations([span], view.sources).length === 0
                ? span.quoted
                : undefined
            rows.push({
              at: startedAt,
              sessionId,
              finding,
              practice:
                practices.get(finding.attemptId) ??
                (assisted.has(finding.attemptId) || view.session?.mode === 'drill'
                  ? 'coached'
                  : view.session?.mode === 'transfer'
                    ? 'transfer'
                    : 'unclassified'),
              superseded: view.supersededFindings?.has(finding.id) ?? false,
              evaluator: evaluations.get(finding.id) ?? null,
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
              .sort(
                (left, right) =>
                  left.at.localeCompare(right.at) ||
                  left.sessionId.localeCompare(right.sessionId) ||
                  left.finding.id.localeCompare(right.finding.id),
              )
              .map((row, index, sorted) => ({
                at: row.at,
                sessionId: row.sessionId,
                finding: wireFindings([row.finding])[0] as never,
                practice: row.practice,
                superseded: row.superseded,
                evaluator: row.evaluator,
                versionChanged:
                  index > 0 &&
                  row.evaluator !== null &&
                  sorted[index - 1]?.evaluator != null &&
                  JSON.stringify(row.evaluator) !== JSON.stringify(sorted[index - 1]?.evaluator),
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
