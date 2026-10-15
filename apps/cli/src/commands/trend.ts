import {
  competenceLane,
  composureByPressure,
  ledgerSnapshots,
  performanceTrends,
  replay,
  type CompetenceSession,
  type PerformanceSession,
} from '@levelhead/core'
import { SIGNALS, type CompetenceLane, type LedgerSnapshot } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { sessionObservations } from './debrief.ts'
import { dim, heading, line } from '../terminal.ts'

function day(at: string): string {
  return at.slice(0, 10)
}

function snapshotLine(snapshot: LedgerSnapshot): string {
  return `  ${day(snapshot.at)} ${snapshot.sessionId}  open ${snapshot.gapsOpen} · drilled ${snapshot.gapsDrilled} · unverified ${snapshot.gapsUnverified} · closed ${snapshot.gapsClosedUnderTransfer} · abstentions ${snapshot.abstentions} · pressure ${snapshot.pressureReached}/3`
}

// Two series over the owner's sessions, drawn apart on purpose. The performance trend is measured and
// the ledger is judged, and there is no axis both belong on.
export async function trend(): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const performance: PerformanceSession[] = []
    const competence: CompetenceSession[] = []
    const findings: CompetenceLane['findings'][number][] = []
    const pressureByAttemptId = new Map<string, number>()

    for (const sessionId of await store.listSessions()) {
      if (sessionId === CLAIM_SET_SESSION) continue
      const view = replay(await store.read(sessionId))
      const at = view.session?.startedAt
      if (at === undefined) continue

      const lane = competenceLane(view)
      performance.push({ sessionId, at, observations: sessionObservations(view) })
      competence.push({ sessionId, at, lane })
      findings.push(...lane.findings)
      for (const [id, attempt] of view.attempts) pressureByAttemptId.set(id, attempt.pressureLevel)
    }

    if (competence.length === 0) {
      line('no sessions yet — run one with: levelhead session')
      return 0
    }

    const snapshots = ledgerSnapshots(competence)

    if (competence.length === 1) {
      heading('trend')
      line('  A trend needs more than one session. Here is the one on record.')
      const snapshot = snapshots[0]
      if (snapshot !== undefined) line(snapshotLine(snapshot))
      const only = performance[0]
      if (only !== undefined) {
        dim(`  ${only.observations.length} performance observations recorded this session.`)
      }
      return 0
    }

    heading('how you came across, over time')
    const trends = performanceTrends(performance)
    if (trends.length === 0) {
      dim('  No performance signals were recorded across these sessions.')
    }
    for (const one of trends) {
      const spec = SIGNALS[one.signal]
      line(`  ${spec.label} (${spec.unit.replace(/_/g, ' ')})`)
      for (const point of one.points) line(`    ${day(point.at)}  ${point.value.toFixed(2)}`)
    }

    heading('the gap ledger, session by session')
    for (const snapshot of snapshots) line(snapshotLine(snapshot))

    heading('composure, by the pressure it held at')
    const rows = composureByPressure({ findings, pressureByAttemptId })
    if (rows.length === 0) {
      dim('  No composure was measured under pressure across these sessions.')
    }
    for (const row of rows) {
      line(`  pressure ${row.level}/3  held ${row.held} · did not hold ${row.folded}`)
    }

    line('')
    dim(
      '  Two series, never merged into one number. A tempo trend and a gap count answer different questions.',
    )
    return 0
  } finally {
    await close()
  }
}
