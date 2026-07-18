import { renderLedger, replay, spanViolations } from '@closer/core'
import type { GapEntry } from '@closer/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'

// A gap can open in one session and close under transfer in another, so the ledger is assembled by
// replaying every log.
export async function ledger(): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)
  const gaps = new Map<string, GapEntry>()
  const quotes = new Map<string, string>()
  let violations = 0

  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    for (const [id, gap] of view.gaps) {
      // Session listing order isn't chronological, so the most recently touched row wins.
      const known = gaps.get(id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(id, gap)
    }
    for (const link of view.evidence.values()) {
      if (link.target.kind !== 'span') continue
      const span = view.spans.get(link.target.spanId)
      if (span !== undefined) quotes.set(link.id, span.quoted)
    }
    violations += spanViolations(view.spans.values(), view.sources).length
  }

  heading('gap ledger')
  if (gaps.size === 0) {
    dim('  no gaps yet — run a session.')
    return 0
  }
  for (const row of renderLedger([...gaps.values()], quotes)) line(row)
  line('')
  // Deliberately the only number on this page — a count of broken citations, never a score.
  dim(violations === 0 ? '  every citation resolves.' : `  ${violations} citations do not resolve.`)
  return violations === 0 ? 0 : 1
}
