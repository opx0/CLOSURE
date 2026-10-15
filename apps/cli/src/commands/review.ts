import { replay, topicById } from '@levelhead/core'
import type { Finding, GapEntry } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line, quote } from '../terminal.ts'
import { topicLabel } from './catalog.ts'

interface Attempted {
  at: string
  sessionId: string
  finding: Finding
  quoted: string | undefined
  topic: string | undefined
}

// Deliberately computed, not narrated by a model — the candidate reads the change in their own words.
export async function review(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)
  const at = argv.indexOf('--competency')
  const wanted = at === -1 ? undefined : argv[at + 1]

  const history = new Map<string, Attempted[]>()
  const gaps = new Map<string, GapEntry>()

  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    const startedAt = view.session?.startedAt ?? ''
    for (const gap of view.gaps.values()) {
      const known = gaps.get(gap.id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(gap.id, gap)
    }
    for (const finding of view.findings) {
      const key =
        finding.kind === 'claim' || finding.kind === 'claim_abstained'
          ? finding.claimId
          : finding.competency
      if (wanted !== undefined && key !== wanted) continue
      const spanId = finding.transcriptSpanIds[0]
      const topicId = view.attempts.get(finding.attemptId)?.topicId
      const topic = topicId === undefined ? undefined : topicById(topicId)
      const rows = history.get(key) ?? []
      rows.push({
        at: startedAt,
        sessionId,
        finding,
        quoted: view.spans.get(spanId)?.quoted,
        topic: topic === undefined ? undefined : topicLabel(topic),
      })
      history.set(key, rows)
    }
  }

  if (history.size === 0) {
    line('nothing to review yet — run a session first.')
    return 0
  }

  for (const [subject, rows] of history) {
    rows.sort((a, b) => a.at.localeCompare(b.at))
    heading(subject)
    for (const row of rows) {
      const verdict =
        row.finding.kind === 'claim'
          ? row.finding.verdict.replace(/_/g, ' ')
          : row.finding.kind === 'claim_abstained' || row.finding.kind === 'competency_abstained'
            ? `abstained: ${row.finding.abstention.replace(/_/g, ' ')}`
            : row.finding.kind === 'composure'
              ? row.finding.signals.join(', ').replace(/_/g, ' ')
              : `met ${row.finding.levelMet ?? 'no level anchor'}`
      line(
        `  ${row.at.slice(0, 10)}  ${verdict}${row.topic === undefined ? '' : ` · ${row.topic}`}`,
      )
      if (row.quoted !== undefined) quote(row.quoted)
    }
    // First and last judgment side by side, deliberately no aggregate over them.
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first !== undefined && last !== undefined && rows.length > 1) {
      dim(
        `  ${rows.length} attempts, first to last: ${first.at.slice(0, 10)} → ${last.at.slice(0, 10)}`,
      )
    }
  }
  return 0
}
