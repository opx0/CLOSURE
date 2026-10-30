import {
  COMPOSURE_HELD,
  LEVEL_ORDER,
  type Competency,
  type Finding,
  type GapEntry,
  type GapStatus,
} from '@levelhead/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'

export interface GapTransition {
  gapId: string
  from: GapStatus
  to: GapStatus
}

export interface LedgerDeps {
  ids: IdSource
  clock: Clock
}

// One gap per competency per claim or topic, so the same weakness found again lands on the existing row.
export function gapKey(competency: Competency, claimId?: string, topicId?: string, artifactId?: string): string {
  const key = `${competency}:${claimId ?? '-'}`
  const topicKey = topicId === undefined ? key : `${key}:${topicId}`
  return artifactId === undefined ? topicKey : `${topicKey}:artifact:${artifactId}`
}

export function indexGaps(gaps: readonly GapEntry[]): Map<string, GapEntry> {
  return new Map(gaps.map((gap) => [gapKey(gap.competency, gap.claimId, gap.topicId, gap.artifactId), gap]))
}

// What the attempt behind the findings was about. Findings do not carry it; the policy action did.
export interface GapSubject {
  topicId?: string
  snapshotId?: string
  artifactId?: string
}

interface GapNeed {
  competency: Competency
  claimId: string | undefined
  topicId: string | undefined
  status: Extract<GapStatus, 'open' | 'unverified'>
}

function needFrom(finding: Finding, topicId: string | undefined): GapNeed | null {
  switch (finding.kind) {
    case 'claim':
      // A claim-shaped gap files under Mechanism (§4.6): unexplained, not a competency judgment.
      return finding.verdict === 'supported'
        ? null
        : { competency: 'mechanism', claimId: finding.claimId, topicId: undefined, status: 'open' }
    case 'claim_abstained':
      return {
        competency: 'mechanism',
        claimId: finding.claimId,
        topicId: undefined,
        status: 'unverified',
      }
    case 'composure':
      // A gap opens only when a signal outside COMPOSURE_HELD appears (§4.3). Composure belongs to
      // the candidate, not to whatever was being asked, so it never carries the topic.
      return finding.signals.every((signal) => COMPOSURE_HELD.includes(signal))
        ? null
        : { competency: 'composure', claimId: undefined, topicId: undefined, status: 'open' }
    case 'competency': {
      const met = finding.levelMet
      const short = met === null || LEVEL_ORDER.indexOf(met) < LEVEL_ORDER.indexOf(finding.level)
      return short
        ? { competency: finding.competency, claimId: undefined, topicId, status: 'open' }
        : null
    }
    case 'competency_abstained':
      return { competency: finding.competency, claimId: undefined, topicId, status: 'unverified' }
  }
}

function bearsOn(finding: Finding, gap: GapEntry): boolean {
  // A project gap can be drilled against the original claim or independently retested on the
  // same competency in an unfamiliar topic. The latter must never need the familiar source.
  if (gap.artifactId !== undefined && (finding.kind === 'competency' || finding.kind === 'competency_abstained'))
    return finding.competency === gap.competency
  switch (finding.kind) {
    case 'claim':
    case 'claim_abstained':
      return finding.claimId === gap.claimId
    case 'composure':
      return gap.competency === 'composure'
    case 'competency':
    case 'competency_abstained':
      return gap.claimId === undefined && finding.competency === gap.competency
  }
}

// Judged by the same rule that opens a gap: held only when something was judged on this gap's own
// competency or claim and none of it would open the gap again. An abstention is not a pass, and
// neither is a pass on a different competency in the same answer.
export function gapHeld(gap: GapEntry, findings: readonly Finding[]): boolean {
  const bearing = findings.filter((finding) => bearsOn(finding, gap))
  return bearing.length > 0 && bearing.every((finding) => needFrom(finding, gap.topicId) === null)
}

// Reopening is possible; un-closing on an abstention is not — silence is not evidence against a gap
// already held under transfer.
function nextStatus(current: GapStatus, wanted: GapNeed['status']): GapStatus | null {
  if (current === 'closed_under_transfer' || current === wanted) return null
  // An abstention never overwrites a judged gap.
  if (wanted === 'unverified') return null
  // A fresh unsupported finding on a drilled gap says the drill did not take.
  return current === 'drilled' || current === 'unverified' ? 'open' : null
}

export function gapsFromFindings(
  findings: readonly Finding[],
  existing: ReadonlyMap<string, GapEntry>,
  deps: LedgerDeps,
  subject: GapSubject = {},
): { opened: GapEntry[]; transitions: GapTransition[] } {
  const opened: GapEntry[] = []
  const openedByKey = new Map<string, GapEntry>()
  const transitions: GapTransition[] = []
  const statusByKey = new Map<string, GapStatus>()
  const usedIds = new Set([...existing.values()].map((gap) => gap.id))

  for (const finding of findings) {
    const need = needFrom(finding, subject.topicId)
    if (need === null) continue

    const project = subject.artifactId !== undefined && subject.snapshotId !== undefined && need.competency !== 'composure'
    const key = gapKey(need.competency, need.claimId, need.topicId, project ? subject.artifactId : undefined)
    const fresh = openedByKey.get(key)
    if (fresh !== undefined) {
      // A second finding about the same gap in this batch joins that row, not a duplicate of it.
      fresh.findingIds.push(finding.id)
      fresh.evidenceIds.push(...finding.evidenceIds)
      continue
    }

    const known = existing.get(key)
    if (known === undefined) {
      let id = deps.ids.next('gap')
      while (usedIds.has(id)) id = deps.ids.next('gap')
      usedIds.add(id)
      const now = deps.clock.now()
      const entry: GapEntry = {
        id,
        competency: need.competency,
        ...(need.claimId === undefined ? {} : { claimId: need.claimId }),
        ...(need.topicId === undefined ? {} : { topicId: need.topicId }),
        ...(project ? { snapshotId: subject.snapshotId!, artifactId: subject.artifactId! } : {}),
        summary: finding.rationale,
        status: need.status,
        findingIds: [finding.id],
        evidenceIds: [...finding.evidenceIds],
        openedAt: now,
        lastTouchedAt: now,
        transferAttemptIds: [],
        retrievals: [],
      }
      opened.push(entry)
      openedByKey.set(key, entry)
      continue
    }

    const current = statusByKey.get(key) ?? known.status
    const to = nextStatus(current, need.status)
    if (to === null) continue

    statusByKey.set(key, to)
    transitions.push({ gapId: known.id, from: current, to })
  }

  return { opened, transitions }
}

const STATUS_LABEL: Record<GapStatus, string> = {
  open: 'open',
  drilled: 'drilled — transfer pending',
  unverified: 'unverified',
  closed_under_transfer: 'closed — held under transfer',
}

const COMPETENCY_LABEL: Record<Competency, string> = {
  mechanism: 'Mechanism',
  trade_offs: 'Trade-offs',
  failure_modes: 'Failure modes',
  composure: 'Composure',
}

function clip(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

// §4.6's four columns and nothing else — no aggregate column, ever (that's the readiness percentage
// Levelhead refuses to produce).
export function renderLedger(
  gaps: readonly GapEntry[],
  quotes: ReadonlyMap<string, string> = new Map(),
): string[] {
  const rows = gaps.map((gap) => {
    const quoted = gap.evidenceIds.map((id) => quotes.get(id)).find((quote) => quote !== undefined)
    return [
      clip(gap.summary, 52),
      COMPETENCY_LABEL[gap.competency],
      quoted === undefined ? '—' : `“${clip(quoted, 38)}”`,
      STATUS_LABEL[gap.status],
    ]
  })

  const header = ['Gap', 'Competency', 'Evidence', 'Status']
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? cell.length))
      .join('  ')
      .trimEnd()

  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)]
}
