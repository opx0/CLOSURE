import type { AnyEvent, Evidence, Finding, GapEntry, ResumeFeedback } from '@levelhead/contracts'
import type { EventStore } from '../ports/event-store.ts'
import { replay } from '../events/replay.ts'
import { quotesFrom } from '../debrief/competence.ts'
import { pinnedSnapshots } from '../repo/pinned.ts'
import { resumeFeedback } from './feedback.ts'

function startedAt(events: readonly AnyEvent[]): string {
  return events[0]?.occurredAt ?? ''
}

export async function assembleResumeFeedback(
  store: EventStore,
  logs: { claimSet: string; repo: string },
): Promise<ResumeFeedback> {
  const claimSet = replay(await store.read(logs.claimSet))
  const repoEvents = await store.read(logs.repo)
  const repo = replay(repoEvents)

  const evidence = new Map<string, Evidence>([...claimSet.evidence, ...repo.evidence])
  const quotes = new Map([...quotesFrom(claimSet), ...quotesFrom(repo)])
  const gaps = new Map<string, GapEntry>()
  const findings: Finding[] = []

  const sessions: AnyEvent[][] = []
  for (const sessionId of await store.listSessions()) {
    if (sessionId === logs.claimSet || sessionId === logs.repo) continue
    sessions.push(await store.read(sessionId))
  }
  // Oldest first, so the verdict a line reports comes from the most recent session.
  sessions.sort((a, b) => startedAt(a).localeCompare(startedAt(b)))

  for (const events of sessions) {
    const view = replay(events)
    findings.push(...view.findings)
    for (const [id, link] of view.evidence) evidence.set(id, link)
    for (const [id, quoted] of quotesFrom(view)) quotes.set(id, quoted)
    for (const [id, gap] of view.gaps) {
      const known = gaps.get(id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(id, gap)
    }
  }

  return resumeFeedback({
    spans: [...claimSet.spans.values()],
    claims: [...claimSet.claims.values()],
    confirmedClaimIds: claimSet.confirmedClaimIds,
    snapshotIds: pinnedSnapshots(repoEvents)
      .filter((entry) => !entry.deleted)
      .map((entry) => entry.snapshot.id),
    artifacts: [...repo.artifacts.values()],
    evidence: [...evidence.values()],
    findings,
    quotes,
    gaps: [...gaps.values()],
  })
}
