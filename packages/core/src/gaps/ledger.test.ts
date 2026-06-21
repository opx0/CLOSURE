import { test, expect } from 'bun:test'
import type { Finding, GapEntry } from '@closer/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'
import {
  applyDrillResult,
  applyTransferResult,
  gapKey,
  gapsFromFindings,
  indexGaps,
  renderLedger,
} from './ledger.ts'

function idSource(): IdSource {
  let issued = 0
  return { next: (prefix) => `${prefix}-${(issued += 1)}` }
}

const clock: Clock = { now: () => '2026-09-09T10:00:00.000Z' }
const deps = { ids: idSource(), clock }

const findingBase = {
  attemptId: 'attempt-1',
  level: 'senior' as const,
  confidence: 0.8,
  modelVersion: 'test-model-alias',
  promptVersion: '1',
  transcriptSpanIds: ['span-1'] as [string],
  evidenceIds: ['evidence-1'] as [string],
}

const claimRubric = { id: 'claim_status', version: 1 }

const unsupported: Finding = {
  ...findingBase,
  id: 'finding-1',
  rubric: claimRubric,
  rationale: 'Recovery is described; double completion after resurrection is not.',
  kind: 'claim',
  claimId: 'claim-1',
  verdict: 'partially_supported',
}

const abstained: Finding = {
  ...findingBase,
  id: 'finding-2',
  rubric: claimRubric,
  rationale: 'The retry policy is referred to but never described.',
  kind: 'claim_abstained',
  claimId: 'claim-1',
  abstention: 'insufficient_evidence',
}

function gapOf(over: Partial<GapEntry> = {}): GapEntry {
  return {
    id: 'gap-1',
    competency: 'mechanism',
    claimId: 'claim-1',
    summary: 'Double completion after worker resurrection',
    status: 'open',
    findingIds: ['finding-1'],
    evidenceIds: ['evidence-1'],
    openedAt: '2026-09-03T10:00:00.000Z',
    lastTouchedAt: '2026-09-03T10:00:00.000Z',
    transferAttemptIds: [],
    retrievals: [],
    ...over,
  }
}

test('a finding that is not fully supported opens a gap carrying its citations forward', () => {
  const { opened, transitions } = gapsFromFindings([unsupported], new Map(), deps)

  expect(transitions).toHaveLength(0)
  expect(opened).toHaveLength(1)
  expect(opened[0]?.status).toBe('open')
  expect(opened[0]?.competency).toBe('mechanism')
  expect(opened[0]?.claimId).toBe('claim-1')
  expect(opened[0]?.findingIds).toEqual(['finding-1'])
  expect(opened[0]?.evidenceIds).toEqual(['evidence-1'])
  expect(opened[0]?.transferAttemptIds).toEqual([])
})

test('a supported claim and held composure open nothing', () => {
  const supported: Finding = { ...unsupported, id: 'finding-3', verdict: 'supported' }
  const composed: Finding = {
    ...findingBase,
    id: 'finding-4',
    rubric: { id: 'composure', version: 1 },
    rationale: 'Held the correct position with a reason.',
    kind: 'composure',
    competency: 'composure',
    signals: ['holding_ground', 'honest_yielding'],
  }

  expect(gapsFromFindings([supported, composed], new Map(), deps).opened).toHaveLength(0)
})

test('folding under pressure opens a composure gap', () => {
  const folded: Finding = {
    ...findingBase,
    id: 'finding-5',
    rubric: { id: 'composure', version: 1 },
    rationale: 'Conceded a correct position about lease ownership with no new evidence.',
    kind: 'composure',
    competency: 'composure',
    signals: ['folding'],
  }

  const { opened } = gapsFromFindings([folded], new Map(), deps)

  expect(opened[0]?.competency).toBe('composure')
  expect(opened[0]?.status).toBe('open')
})

test('an abstention opens a gap as unverified, and never overwrites one already judged', () => {
  const fresh = gapsFromFindings([abstained], new Map(), deps)
  expect(fresh.opened[0]?.status).toBe('unverified')

  // Silence must not read as a downgrade — the earlier judgment stands (§4.6).
  for (const status of ['open', 'drilled'] as const) {
    const existing = indexGaps([gapOf({ status })])
    const seen = gapsFromFindings([abstained], existing, deps)
    expect(seen.opened).toHaveLength(0)
    expect(seen.transitions).toEqual([])
  }
})

test('an abstention never un-closes a gap that held under transfer', () => {
  const existing = indexGaps([gapOf({ status: 'closed_under_transfer' })])

  expect(gapsFromFindings([abstained], existing, deps).transitions).toHaveLength(0)
})

test('two findings about the same gap land on one row', () => {
  const second: Finding = { ...unsupported, id: 'finding-6', evidenceIds: ['evidence-2'] }

  const { opened } = gapsFromFindings([unsupported, second], new Map(), deps)

  expect(opened).toHaveLength(1)
  expect(opened[0]?.findingIds).toEqual(['finding-1', 'finding-6'])
  expect(opened[0]?.evidenceIds).toEqual(['evidence-1', 'evidence-2'])
})

test('passing the drill moves open to drilled and closes nothing', () => {
  const { gap, transition } = applyDrillResult(gapOf(), true, { clock })

  expect(gap.status).toBe('drilled')
  expect(transition).toEqual({ gapId: 'gap-1', from: 'open', to: 'drilled' })
  expect(gap.transferAttemptIds).toEqual([])

  const again = applyDrillResult(gap, true, { clock })
  expect(again.gap.status).toBe('drilled')
  expect(again.transition).toBeNull()
})

test('a failed drill leaves the gap open', () => {
  const { gap, transition } = applyDrillResult(gapOf(), false, { clock })

  expect(gap.status).toBe('open')
  expect(transition).toBeNull()
})

test('only a passed transfer reaches closed_under_transfer', () => {
  const drilled = gapOf({ status: 'drilled' })

  const failed = applyTransferResult(drilled, 'attempt-9', false, { clock })
  expect(failed.gap.status).toBe('open')
  expect(failed.gap.transferAttemptIds).toEqual(['attempt-9'])

  const passed = applyTransferResult(failed.gap, 'attempt-12', true, { clock })
  expect(passed.gap.status).toBe('closed_under_transfer')
  expect(passed.gap.transferAttemptIds).toEqual(['attempt-9', 'attempt-12'])
  expect(passed.transition).toEqual({ gapId: 'gap-1', from: 'open', to: 'closed_under_transfer' })
})

test('a closed gap carries the transfer attempt that closed it', () => {
  const closed = applyTransferResult(gapOf(), 'attempt-12', true, { clock }).gap

  expect(closed.status).toBe('closed_under_transfer')
  expect(closed.transferAttemptIds.length).toBeGreaterThan(0)
})

test('the ledger renders four columns and no aggregate of any kind', () => {
  const gaps = [
    gapOf({ status: 'closed_under_transfer', transferAttemptIds: ['attempt-12'] }),
    gapOf({
      id: 'gap-2',
      competency: 'composure',
      summary: 'Folds under a false premise about lease ownership',
      status: 'open',
      evidenceIds: ['evidence-3'],
    }),
  ]
  const quotes = new Map([
    ['evidence-1', "I don't think we handled that."],
    ['evidence-3', 'Conceded without evidence.'],
  ])

  const rows = renderLedger(gaps, quotes)

  expect(rows[0]).toContain('Gap')
  expect(rows[0]).toContain('Competency')
  expect(rows[0]).toContain('Evidence')
  expect(rows[0]).toContain('Status')
  expect(rows).toHaveLength(4)
  expect(rows[2]).toContain('Mechanism')
  expect(rows[2]).toContain("I don't think we handled that.")
  expect(rows[2]).toContain('closed — held under transfer')
  expect(rows[3]).toContain('Composure')
  expect(rows.join('\n')).not.toMatch(/%|score|readiness|overall|\bavg\b/i)
})

test('the ledger renders without a quote lookup', () => {
  expect(renderLedger([gapOf()])[2]).toContain('—')
})

test('gap identity is one row per competency per claim', () => {
  expect(gapKey('mechanism', 'claim-1')).not.toBe(gapKey('failure_modes', 'claim-1'))
  expect(gapKey('composure')).toBe(gapKey('composure', undefined))
})
