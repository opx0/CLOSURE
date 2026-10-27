import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { DebriefSchema } from '@levelhead/contracts'
import type { PerformanceBaseline, PerformanceObservation } from '@levelhead/contracts'
import {
  buildDebrief,
  improvementPlan,
  gapsAcrossViews,
  contrastsAcrossSession,
  drillsFor,
  notesFrom,
  observationsAcrossSession,
  observationsFromKinematics,
  observationsFromProsody,
  replay,
  type SessionAttemptInput,
} from '@levelhead/core'
import type { ServerDeps } from '../deps.ts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { ErrorSchema, SessionIdParamsSchema } from './shared.ts'

// The one surface that shows both lanes. It is only allowed to put one after the other: the two
// lanes are computed by two core modules that name no type in common (invariant 8), and this route
// hands each the session and never lets a number cross from one to the other.
export function debriefRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/sessions/:id/debrief',
      {
        schema: {
          summary:
            'End-of-session report: the competence lane and the performance lane, never merged',
          tags: ['debrief'],
          params: SessionIdParamsSchema,
          response: {
            200: DebriefSchema,
            404: ErrorSchema,
            409: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const store = deps.storeFor(request.principal)
        const events = await store.read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        const view = replay(events)
        if (view.session?.mode === 'simulation' && view.closed === null)
          return reply.code(409).send({
            error: 'Finish the simulation before opening its debrief',
            detail: 'Feedback remains withheld.',
          })

        // Pressure level and whether the answer followed an interruption are read from the session's
        // own attempts rather than inferred here: an attempt whose selected policy action was
        // INTERRUPT is one the candidate answered after being cut off. The performance module never
        // reaches into the policy that produced them, so this route supplies them.
        const attemptInputs: SessionAttemptInput[] = view.prosody.flatMap((prosody) => {
          const attempt = view.attempts.get(prosody.attemptId)
          if (attempt === undefined) return []
          return [
            {
              prosody,
              pressureLevel: attempt.pressureLevel,
              followedInterruption: attempt.action === 'INTERRUPT',
            },
          ]
        })

        const observations: PerformanceObservation[] = [
          ...view.prosody.flatMap((report) => observationsFromProsody(report)),
          ...view.kinematics.flatMap((report) => observationsFromKinematics(report)),
          ...observationsAcrossSession(attemptInputs),
        ]

        // A baseline is the candidate's own distribution across their PAST sessions. This endpoint
        // replays one session and loads no history, so there is nothing to compare against yet;
        // performanceLane reports every signal measured here under signalsWithoutBaseline. Loading
        // cross-session history to seed baselines is a separate endpoint in this wave.
        const baselines: PerformanceBaseline[] = []
        const contrasts = contrastsAcrossSession(attemptInputs)
        const notes = notesFrom({ observations, baselines, contrasts })
        const drills = drillsFor(notes)

        const report = buildDebrief({
          view,
          generatedAt: deps.clock.now(),
          performance: { observations, notes, drills, baselines },
        })
        const history = await Promise.all(
          (await store.listSessions()).map(async (id) =>
            id === request.params.id ? view : replay(await store.read(id)),
          ),
        )
        const exposedVariants = new Set(
          history.flatMap((entry) =>
            entry.session?.practiceVariantId === undefined
              ? []
              : [`${entry.session.practiceVariantId}@${entry.session.practiceVariantVersion}`],
          ),
        )
        const claimSet = replay(await store.read(CLAIM_SET_SESSION))
        const confirmedClaims = new Map(
          [...claimSet.claims].filter(([id]) => claimSet.confirmedClaimIds.has(id)),
        )
        report.competence.plan = improvementPlan(view, {
          gaps: gapsAcrossViews(history),
          exposedVariants,
          confirmedClaims,
        })
        return report
      },
    )
  }
}
