import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  ComposureByPressureSchema,
  LedgerSnapshotSchema,
  PerformanceTrendSchema,
  widenFindings,
  type PerformanceObservation,
} from '@levelhead/contracts'
import {
  competenceLane,
  composureByPressure,
  ledgerSnapshots,
  observationsAcrossSession,
  observationsFromKinematics,
  observationsFromProsody,
  performanceTrends,
  replay,
  type CompetenceSession,
  type PerformanceSession,
  type SessionAttemptInput,
} from '@levelhead/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import type { ServerDeps } from '../deps.ts'

// The longitudinal view, over HTTP. Two series that never become one: the performance trends and the
// gap-ledger snapshots are computed by two core modules that name no type in common, and this route
// only puts the two arrays side by side in the response — the same wall the debrief keeps.
export function analyticsRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/analytics',
      {
        schema: {
          summary:
            'Longitudinal trends and gap-ledger snapshots across every session — no aggregate',
          tags: ['analytics'],
          response: {
            200: Type.Object({
              performance: Type.Array(PerformanceTrendSchema),
              ledger: Type.Array(LedgerSnapshotSchema),
              composure: Type.Array(ComposureByPressureSchema),
            }),
          },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)

        const performanceSessions: PerformanceSession[] = []
        const competenceSessions: CompetenceSession[] = []
        const findings = []
        const pressureByAttemptId = new Map<string, number>()

        for (const sessionId of await store.listSessions()) {
          // The claim-set pseudo-session holds confirmed claims, not an interview, so it has no
          // trend and no gap ledger of its own.
          if (sessionId === CLAIM_SET_SESSION) continue
          const view = replay(await store.read(sessionId))
          if (view.session === null || (view.session.mode === 'simulation' && view.closed === null))
            continue
          const at = view.session.startedAt

          const attempts: SessionAttemptInput[] = view.prosody.map((report) => {
            const attempt = view.attempts.get(report.attemptId)
            return {
              prosody: report,
              pressureLevel: attempt?.pressureLevel ?? 0,
              followedInterruption: attempt?.action === 'INTERRUPT',
            }
          })

          const observations: PerformanceObservation[] = [
            ...view.prosody.flatMap((report) => observationsFromProsody(report)),
            ...view.kinematics.flatMap((report) => observationsFromKinematics(report)),
            ...observationsAcrossSession(attempts),
          ]
          if (observations.length > 0) performanceSessions.push({ sessionId, at, observations })

          const lane = competenceLane(view)
          competenceSessions.push({ sessionId, at, lane })
          findings.push(...widenFindings(view.findings))
          for (const [attemptId, attempt] of view.attempts) {
            pressureByAttemptId.set(attemptId, attempt.pressureLevel)
          }
        }

        return {
          performance: performanceTrends(performanceSessions),
          ledger: ledgerSnapshots(competenceSessions),
          composure: composureByPressure({ findings, pressureByAttemptId }),
        }
      },
    )
  }
}
