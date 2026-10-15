import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ResumeFeedbackSchema } from '@levelhead/contracts'
import { assembleResumeFeedback } from '@levelhead/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { ServerDeps } from '../deps.ts'

export function resumeRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/resume/feedback',
      {
        schema: {
          summary:
            'Per résumé line: what held, what was contradicted, what is vague, what no linked code ' +
            'backs, each with the evidence behind it',
          tags: ['claims'],
          response: { 200: ResumeFeedbackSchema },
        },
      },
      async (request) =>
        assembleResumeFeedback(deps.storeFor(request.principal), {
          claimSet: CLAIM_SET_SESSION,
          repo: REPO_SESSION,
        }),
    )
  }
}
