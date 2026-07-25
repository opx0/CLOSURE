import { createHash } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ClaimSchema, SpanSchema } from '@closer/contracts'
import {
  SessionLog,
  claimConfirmedPayload,
  claimsExtractedPayload,
  extractClaims,
  replay,
} from '@closer/core'
// Imported rather than hardcoded: two callers spelling this string independently would drift.
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

const RejectedQuoteSchema = Type.Object({
  quote: Type.String(),
  reason: Type.String(),
})

// Same two steps as `closer claims`, against the same log — a claim set extracted here is the one
// `closer session` interrogates.
export function claimsRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/claims',
      {
        schema: {
          summary: 'Extract the claim set from a résumé, sourced to byte-exact spans',
          tags: ['claims'],
          body: Type.Object({ resumeText: Type.String({ minLength: 1 }) }),
          response: {
            200: Type.Object({
              sourceId: Type.String({ minLength: 1 }),
              claims: Type.Array(ClaimSchema),
              // Spans travel with claims so the caller can verify each claim against the bytes it posted.
              spans: Type.Array(SpanSchema),
              // Explicit list: a claim silently dropped would be indistinguishable from one never made.
              rejected: Type.Array(RejectedQuoteSchema),
            }),
            502: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const { resumeText } = request.body
        const hash = createHash('sha256').update(resumeText).digest('hex')
        const sourceId = `resume:${hash.slice(0, 12)}`

        const store = deps.storeFor(request.principal)
        const log = await SessionLog.open(
          { store, clock: deps.clock, ids: deps.ids },
          CLAIM_SET_SESSION,
        )
        const already = replay(await store.read(CLAIM_SET_SESSION))
        if (!already.sources.has(sourceId)) {
          await log.append('state_change', {
            change: 'source_registered',
            sourceId,
            kind: 'resume',
            text: resumeText,
            contentHash: hash,
          })
        }

        const result = await extractClaims({
          resumeText,
          sourceId,
          evaluator: deps.evaluator,
          ids: deps.ids,
          clock: deps.clock,
        })

        // ADR-012: a failure returns 502, not an empty 200 — empty would falsely read as "no claims".
        if ('failed' in result) {
          return reply
            .code(502)
            .send({ error: 'claim extraction failed', detail: result.failed.kind })
        }

        await log.append('state_change', claimsExtractedPayload(result))
        return { sourceId, claims: result.claims, spans: result.spans, rejected: result.rejected }
      },
    )

    app.post(
      '/claims/:id/confirm',
      {
        schema: {
          summary: 'Confirm, reject or reword a claim (§4.1: the candidate owns the claim set)',
          tags: ['claims'],
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({
            confirmed: Type.Boolean(),
            // The candidate may reword while confirming, so interrogation targets what they agreed to.
            editedAssertion: Type.Optional(Type.String({ minLength: 1 })),
          }),
          response: {
            200: Type.Object({ claim: ClaimSchema }),
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const claimId = request.params.id
        const store = deps.storeFor(request.principal)
        const before = replay(await store.read(CLAIM_SET_SESSION))
        if (!before.claims.has(claimId)) {
          return reply.code(404).send({ error: 'no such claim', detail: claimId })
        }

        const log = await SessionLog.open(
          { store, clock: deps.clock, ids: deps.ids },
          CLAIM_SET_SESSION,
        )
        await log.append(
          'state_change',
          claimConfirmedPayload({
            claimId,
            confirmed: request.body.confirmed,
            ...(request.body.editedAssertion === undefined
              ? {}
              : { editedAssertion: request.body.editedAssertion }),
          }),
        )

        // Replayed from the log rather than patched in hand — the fold is what applies the edit.
        const after = replay(await store.read(CLAIM_SET_SESSION))
        const claim = after.claims.get(claimId)
        if (claim === undefined) {
          return reply.code(404).send({ error: 'no such claim', detail: claimId })
        }
        return { claim }
      },
    )
  }
}
