import { createHash } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ScreenSimulationSchema, untrusted } from '@levelhead/contracts'
import { replay, simulateScreen } from '@levelhead/core'
// Imported rather than hardcoded: the claim set lives in one shared session, and two callers
// spelling its id independently would drift. `claimsRoutes` reads the same session the same way.
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import type { ServerDeps } from '../deps.ts'

// A model of the automated résumé screen on the other side of an application, run against one job
// description. It is never a judgment of the candidate and never an input to one: it reads state,
// writes to no event log, and never touches a finding. The job description and the résumé are
// untrusted content (AGENTS.md, ADR-014) — hashed and scanned for terms, never trusted as
// instructions. There is no match number, by design (ScreenSimulation produces none).
export function mirrorRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/mirror',
      {
        schema: {
          summary:
            'Simulate an external résumé screen against one job description — never a verdict',
          tags: ['mirror'],
          // The résumé is the one already extracted through `/claims`: its claims and spans are read
          // back from the shared claim-set session, keyed by the same source id that route derived,
          // so there is nothing more to pass and the spans line up with the résumé byte-for-byte.
          body: Type.Object({
            jobDescription: Type.String({ minLength: 1 }),
            resumeText: Type.String({ minLength: 1 }),
          }),
          response: {
            200: ScreenSimulationSchema,
          },
        },
      },
      async (request) => {
        const { jobDescription, resumeText } = request.body

        // Same derivation claimsRoutes uses, so the source id here is the one the claim set was
        // extracted under.
        const hash = createHash('sha256').update(resumeText).digest('hex')
        const resumeSourceId = `resume:${hash.slice(0, 12)}`

        const view = replay(await deps.storeFor(request.principal).read(CLAIM_SET_SESSION))
        const spans = [...view.spans.values()].filter((span) => span.sourceId === resumeSourceId)
        const spanIds = new Set(spans.map((span) => span.id))
        const claims = [...view.claims.values()].filter((claim) => spanIds.has(claim.spanId))

        return simulateScreen({
          jobDescription: untrusted(jobDescription),
          resumeText: untrusted(resumeText),
          resumeSourceId,
          spans,
          claims,
        })
      },
    )
  }
}
