import { EXPORT_FORMAT_VERSION, widenFindings } from '@levelhead/contracts'
import type { AnyEvent, ExportBundle, ExportedSession, OwnerId } from '@levelhead/contracts'
import { replay } from '../events/replay.ts'

const NOTE =
  'Everything Levelhead holds about this owner, as raw append-only events plus the view they fold into. ' +
  'Deleted repository snapshots appear as tombstones: the citation is kept, the bytes are gone.'

export interface ExportableSession {
  sessionId: string
  events: readonly AnyEvent[]
}

export function exportSession(input: ExportableSession): ExportedSession {
  const view = replay(input.events)
  return {
    sessionId: input.sessionId,
    session: view.session,
    events: [...input.events],
    transcript: [...view.transcript],
    claims: [...view.claims.values()],
    spans: [...view.spans.values()],
    evidence: [...view.evidence.values()],
    artifacts: [...view.artifacts.values()],
    findings: widenFindings(view.findings),
    gaps: [...view.gaps.values()],
    invocations: [...view.invocations],
    snapshot: view.snapshot,
    tombstones: [...view.tombstones],
  }
}

export function buildExportBundle(input: {
  ownerId: OwnerId
  producedAt: string
  sessions: readonly ExportableSession[]
}): ExportBundle {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    ownerId: input.ownerId,
    producedAt: input.producedAt,
    sessions: input.sessions.filter((session) => session.events.length > 0).map(exportSession),
    note: NOTE,
  }
}
