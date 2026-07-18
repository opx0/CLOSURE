import { replay as fold, spanViolations } from '@closer/core'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line, quote } from '../terminal.ts'

export async function replaySession(argv: readonly string[]): Promise<number> {
  const [sessionId] = argv
  const config = loadCliConfig()
  const { store } = openStore(config)

  if (sessionId === undefined) {
    heading('sessions')
    for (const id of await store.listSessions()) line(`  ${id}`)
    return 0
  }

  const events = await store.read(sessionId)
  const view = fold(events)

  heading(`${sessionId} — ${events.length} events`)
  for (const turn of view.transcript) {
    line('')
    line(turn.role === 'interviewer' ? `interviewer: ${turn.text}` : `you: ${turn.text}`)
  }

  heading('findings')
  for (const finding of view.findings) {
    line('')
    line(`${finding.kind} · ${finding.rationale}`)
    for (const spanId of finding.transcriptSpanIds) {
      const span = view.spans.get(spanId)
      if (span !== undefined) quote(span.quoted)
    }
  }

  // Replaying is also the audit: ticket 05 §3 makes an unresolvable citation a bug, not a low score.
  const violations = spanViolations(view.spans.values(), view.sources)
  heading('citations')
  if (violations.length === 0) dim(`  all ${view.spans.size} spans resolve byte-for-byte.`)
  for (const violation of violations) line(`  ✗ ${violation.spanId}: ${violation.reason}`)
  return violations.length === 0 ? 0 : 1
}
