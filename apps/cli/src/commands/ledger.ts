import { gapsAcrossViews } from '@levelhead/core'
import { renderLedger, replay, spanViolations, topicById } from '@levelhead/core'
import type { GapEntry } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'

export function titled(gap: GapEntry): GapEntry {
  const topic = gap.topicId === undefined ? undefined : topicById(gap.topicId)
  return topic === undefined ? gap : { ...gap, summary: `${topic.title}: ${gap.summary}` }
}

// A gap can open in one session and close under transfer in another, so the ledger is assembled by
// replaying every log.
export async function ledger(): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)
  const views: ReturnType<typeof replay>[] = []
  const quotes = new Map<string, string>()
  let violations = 0

  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    views.push(view)
    for (const link of view.evidence.values()) {
      if (link.target.kind !== 'span') continue
      const span = view.spans.get(link.target.spanId)
      if (span !== undefined) quotes.set(link.id, span.quoted)
    }
    violations += spanViolations(view.spans.values(), view.sources).length
  }

  const gaps = gapsAcrossViews(views)
  heading('gap ledger')
  if (gaps.size === 0) {
    dim('  no gaps yet — run a session.')
    return 0
  }
  for (const row of renderLedger([...gaps.values()].map(titled), quotes)) line(row)
  line('')
  // Deliberately the only number on this page — a count of broken citations, never a score.
  dim(violations === 0 ? '  every citation resolves.' : `  ${violations} citations do not resolve.`)
  return violations === 0 ? 0 : 1
}
