import {
  COMPOSURE_HELD,
  LEVEL_ORDER,
  type Competency,
  type Finding,
  type GapEntry,
  type GapStatus,
} from '@closer/contracts'
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

// One gap per competency per claim, so the same weakness found again lands on the existing row.
export function gapKey(competency: Competency, claimId?: string): string {
  return `${competency}:${claimId ?? '-'}`
}

export function indexGaps(gaps: readonly GapEntry[]): Map<string, GapEntry> {
  return new Map(gaps.map((gap) => [gapKey(gap.competency, gap.claimId), gap]))
}

interface GapNeed {
  competency: Competency
  claimId: string | undefined
  status: Extract<GapStatus, 'open' | 'unverified'>
}

function needFrom(finding: Finding): GapNeed | null {
  switch (finding.kind) {
    case 'claim':
      // A claim-shaped gap files under Mechanism (§4.6): unexplained, not a competency judgment.
      return finding.verdict === 'supported'
        ? null
        : { competency: 'mechanism', claimId: finding.claimId, status: 'open' }
    case 'claim_abstained':
      return { competency: 'mechanism', claimId: finding.claimId, status: 'unverified' }
    case 'composure':
      // A gap opens only when a signal outside COMPOSURE_HELD appears (§4.3).
      return finding.signals.every((signal) => COMPOSURE_HELD.includes(signal))
        ? null
        : { competency: 'composure', claimId: undefined, status: 'open' }
    case 'competency': {
      const met = finding.levelMet
      const short = met === null || LEVEL_ORDER.indexOf(met) < LEVEL_ORDER.indexOf(finding.level)
      return short ? { competency: finding.competency, claimId: undefined, status: 'open' } : null
    }
  }
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
): { opened: GapEntry[]; transitions: GapTransition[] } {
  const opened: GapEntry[] = []
  const openedByKey = new Map<string, GapEntry>()
  const transitions: GapTransition[] = []
  const statusByKey = new Map<string, GapStatus>()

  for (const finding of findings) {
    const need = needFrom(finding)
    if (need === null) continue

    const key = gapKey(need.competency, need.claimId)
    const fresh = openedByKey.get(key)
    if (fresh !== undefined) {
      // A second finding about the same gap in this batch joins that row, not a duplicate of it.
      fresh.findingIds.push(finding.id)
      fresh.evidenceIds.push(...finding.evidenceIds)
      continue
    }

    const known = existing.get(key)
    if (known === undefined) {
      const now = deps.clock.now()
      const entry: GapEntry = {
        id: deps.ids.next('gap'),
        competency: need.competency,
        ...(need.claimId === undefined ? {} : { claimId: need.claimId }),
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

export function applyDrillResult(
  gap: GapEntry,
  passed: boolean,
  deps: { clock: Clock },
): { gap: GapEntry; transition: GapTransition | null } {
  // A passed drill moves open to drilled and stops there (§4.5) — do not reach for
  // closed_under_transfer here.
  if (!passed || gap.status !== 'open') return { gap, transition: null }

  return {
    gap: { ...gap, status: 'drilled', lastTouchedAt: deps.clock.now() },
    transition: { gapId: gap.id, from: gap.status, to: 'drilled' },
  }
}

export function applyTransferResult(
  gap: GapEntry,
  attemptId: string,
  passed: boolean,
  deps: { clock: Clock },
): { gap: GapEntry; transition: GapTransition | null } {
  const transferAttemptIds = gap.transferAttemptIds.includes(attemptId)
    ? gap.transferAttemptIds
    : [...gap.transferAttemptIds, attemptId]

  // The recorded attempt licenses the close — a closed_under_transfer row with nothing behind it is
  // a closed gap nobody can audit.
  const closes = passed && transferAttemptIds.length > 0
  const to: GapStatus = closes ? 'closed_under_transfer' : 'open'

  return {
    gap: { ...gap, transferAttemptIds, status: to, lastTouchedAt: deps.clock.now() },
    transition: to === gap.status ? null : { gapId: gap.id, from: gap.status, to },
  }
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
// CLOSER refuses to produce).
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
