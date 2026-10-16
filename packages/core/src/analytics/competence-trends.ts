import {
  COMPOSURE_HELD,
  type CompetenceLane,
  type ComposureByPressure,
  type GapStatus,
  type LedgerSnapshot,
} from '@levelhead/contracts'

// The longitudinal half of the competence lane. It may name anything that was judged, and it may name
// nothing that was measured from a microphone or a camera.

export interface CompetenceSession {
  readonly sessionId: string
  readonly at: string
  readonly lane: CompetenceLane
}

export function ledgerSnapshots(sessions: readonly CompetenceSession[]): LedgerSnapshot[] {
  return [...sessions]
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .map(({ sessionId, at, lane }) => {
      const counting = (status: GapStatus): number =>
        lane.gaps.filter((gap) => gap.status === status).length
      return {
        at,
        sessionId,
        gapsOpen: counting('open'),
        gapsDrilled: counting('drilled'),
        gapsUnverified: counting('unverified'),
        gapsClosedUnderTransfer: counting('closed_under_transfer'),
        abstentions: lane.abstentions,
        pressureReached: lane.pressureReached,
      }
    })
}

// The lane's own array type, so a caller holding a `CompetenceLane` passes `lane.findings` straight
// in and a caller holding a replayed session passes `widenFindings(view.findings)`.
export interface ComposureByPressureInput {
  readonly findings: CompetenceLane['findings']
  // Every attempt in the sessions the findings came from. A composure finding names an attempt, and
  // the attempt is the only thing that knows what pressure the question carried.
  readonly pressureByAttemptId: ReadonlyMap<string, number>
}

// The one cross-cut worth drawing, and both axes come from findings, so it never leaves this lane.
export function composureByPressure(input: ComposureByPressureInput): ComposureByPressure[] {
  const rows = new Map<number, { held: number; folded: number }>()

  for (const finding of input.findings) {
    if (finding.kind !== 'composure') continue
    const level = input.pressureByAttemptId.get(finding.attemptId)
    if (level === undefined) {
      // Placing it at a guessed level would draw a chart the session never produced.
      throw new Error(
        `composureByPressure: no pressure level for attempt ${finding.attemptId} (finding ${finding.id})`,
      )
    }
    const row = rows.get(level) ?? { held: 0, folded: 0 }
    // The same rule the gap ledger opens a composure gap on, so the chart and the ledger agree.
    if (finding.signals.every((signal) => COMPOSURE_HELD.includes(signal))) row.held += 1
    else row.folded += 1
    rows.set(level, row)
  }

  // Only levels that actually carried a composure finding. A zero row for level 3 would read as a
  // session that reached level 3 and held nothing there.
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, counts]) => ({ level, held: counts.held, folded: counts.folded }))
}
