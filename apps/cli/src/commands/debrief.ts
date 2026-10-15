import {
  baselinesFrom,
  buildDebrief,
  contrastsAcrossSession,
  drillsFor,
  notesFrom,
  observationsAcrossSession,
  observationsFromKinematics,
  observationsFromProsody,
  quotesFrom,
  renderDebrief,
  replay,
  type SessionAttemptInput,
  type SessionView,
  type TimestampedObservation,
} from '@levelhead/core'
import type { PerformanceObservation } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, line } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// An attempt whose interviewer action was INTERRUPT is the one the candidate resumed under, so its
// recording is the answer that followed an interruption. The pressure the question carried is on the
// attempt too. This is the single place the two performance-lane cross-cuts read those facts.
export function attemptInputsOf(view: SessionView): SessionAttemptInput[] {
  return view.prosody.flatMap((report) => {
    const attempt = view.attempts.get(report.attemptId)
    if (attempt === undefined) return []
    return [
      {
        prosody: report,
        pressureLevel: attempt.pressureLevel,
        followedInterruption: attempt.action === 'INTERRUPT',
      },
    ]
  })
}

// Every observation one session produced: one per recorded report, plus the cross-attempt signals
// that only exist over the whole session. Shared with `trend`, so a signal is measured the same way
// in the single-session debrief and in the longitudinal view.
export function sessionObservations(view: SessionView): PerformanceObservation[] {
  return [
    ...view.prosody.flatMap(observationsFromProsody),
    ...view.kinematics.flatMap(observationsFromKinematics),
    ...observationsAcrossSession(attemptInputsOf(view)),
  ]
}

// The end-of-session report, both lanes side by side. The competence lane is judged; the performance
// lane is only observed, and its own renderer closes with the line that says so.
export async function debrief(argv: readonly string[]): Promise<number> {
  const sessionId = flag(argv, 'session')
  if (sessionId === undefined) {
    line('levelhead debrief --session <id>')
    return 1
  }

  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const events = await store.read(sessionId)
    if (events.length === 0) {
      line(`no such session: ${sessionId}`)
      return 1
    }
    const view = replay(events)

    // The candidate's own past, and only the past — the baseline is their own distribution over their
    // other sessions. A session that measured nothing contributes nothing rather than an empty band.
    const history: TimestampedObservation[] = []
    let priorSessions = 0
    for (const other of await store.listSessions()) {
      if (other === sessionId) continue
      const otherView = replay(await store.read(other))
      const at = otherView.session?.startedAt
      const observations = sessionObservations(otherView)
      if (at === undefined || observations.length === 0) continue
      priorSessions += 1
      for (const observation of observations) history.push({ observation, at })
    }

    const observations = sessionObservations(view)
    const baselines = baselinesFrom(history)
    const notes = notesFrom({
      observations,
      baselines,
      contrasts: contrastsAcrossSession(attemptInputsOf(view)),
    })

    const report = buildDebrief({
      view,
      generatedAt: new Date().toISOString(),
      performance: { observations, notes, drills: drillsFor(notes), baselines },
    })

    for (const row of renderDebrief(report, quotesFrom(view))) line(row)

    // The renderer says a signal is a first measurement; only the command knows the cause is that no
    // earlier session exists to compare against.
    if (priorSessions === 0 && observations.length > 0) {
      line('')
      dim(
        '  This is the only session on record, so every signal above is a first measurement with no baseline behind it.',
      )
    }
    return 0
  } finally {
    await close()
  }
}
