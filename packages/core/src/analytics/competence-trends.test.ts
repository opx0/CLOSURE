import { expect, test } from 'bun:test'
import {
  widenFindings,
  type CompetenceLane,
  type ComposureSignal,
  type Finding,
  type GapEntry,
} from '@levelhead/contracts'
import {
  composureByPressure,
  ledgerSnapshots,
  type CompetenceSession,
} from './competence-trends.ts'

function gapOf(id: string, status: GapEntry['status']): GapEntry {
  return {
    id,
    competency: 'mechanism',
    summary: `gap ${id}`,
    status,
    findingIds: ['finding-1'],
    evidenceIds: [],
    openedAt: '2026-09-03T10:00:00.000Z',
    lastTouchedAt: '2026-09-03T10:00:00.000Z',
    transferAttemptIds: [],
  }
}

function laneOf(over: Partial<CompetenceLane>): CompetenceLane {
  return { findings: [], gaps: [], abstentions: 0, pressureReached: 0, ...over }
}

const sessions: CompetenceSession[] = [
  {
    sessionId: 'ses_2',
    at: '2026-09-12T10:00:00.000Z',
    lane: laneOf({
      gaps: [gapOf('gap-1', 'closed_under_transfer'), gapOf('gap-2', 'drilled')],
      abstentions: 0,
      pressureReached: 2,
    }),
  },
  {
    sessionId: 'ses_1',
    at: '2026-09-03T10:00:00.000Z',
    lane: laneOf({
      gaps: [gapOf('gap-1', 'open'), gapOf('gap-2', 'open'), gapOf('gap-3', 'unverified')],
      abstentions: 2,
      pressureReached: 1,
    }),
  },
]

test('a snapshot counts the ledger by status, in time order, whatever order it was handed', () => {
  expect(ledgerSnapshots(sessions)).toEqual([
    {
      at: '2026-09-03T10:00:00.000Z',
      sessionId: 'ses_1',
      gapsOpen: 2,
      gapsDrilled: 0,
      gapsUnverified: 1,
      gapsClosedUnderTransfer: 0,
      abstentions: 2,
      pressureReached: 1,
    },
    {
      at: '2026-09-12T10:00:00.000Z',
      sessionId: 'ses_2',
      gapsOpen: 0,
      gapsDrilled: 1,
      gapsUnverified: 0,
      gapsClosedUnderTransfer: 1,
      abstentions: 0,
      pressureReached: 2,
    },
  ])
})

test('no session means no series, not a series of zeroes', () => {
  expect(ledgerSnapshots([])).toEqual([])
})

function composure(id: string, attemptId: string, signals: ComposureSignal[]): Finding {
  return {
    id,
    attemptId,
    rubric: { id: 'composure', version: 2 },
    level: 'senior',
    rationale: 'composure under a false premise',
    confidence: 0.9,
    modelVersion: 'test-model',
    promptVersion: '1',
    transcriptSpanIds: ['span-1'],
    evidenceIds: ['evidence-1'],
    kind: 'composure',
    competency: 'composure',
    signals,
  }
}

const pressureByAttemptId = new Map([
  ['att_1', 0],
  ['att_2', 2],
  ['att_3', 2],
  ['att_4', 2],
])

const findings = widenFindings([
  composure('finding-1', 'att_1', ['holding_ground']),
  composure('finding-2', 'att_2', ['honest_yielding', 'coherence_after_interruption']),
  composure('finding-3', 'att_3', ['folding']),
  composure('finding-4', 'att_4', ['holding_ground', 'fabricating']),
])

test('composure is counted held against folded at the level it was asked at', () => {
  expect(composureByPressure({ findings, pressureByAttemptId })).toEqual([
    { level: 0, held: 1, folded: 0 },
    { level: 2, held: 1, folded: 2 },
  ])
})

// A level nobody was asked at gets no row. A zero row for level 3 would read as a session that
// reached level 3 and held nothing there.
test('only levels that carried a composure finding appear', () => {
  const rows = composureByPressure({ findings, pressureByAttemptId })

  expect(rows.map((row) => row.level)).toEqual([0, 2])
})

test('a finding whose attempt has no recorded pressure stops the chart instead of guessing a level', () => {
  expect(() =>
    composureByPressure({ findings, pressureByAttemptId: new Map([['att_1', 0]]) }),
  ).toThrow('composureByPressure: no pressure level for attempt att_2 (finding finding-2)')
})

test('findings that are not about composure are not counted as composure', () => {
  const claim = widenFindings([
    {
      id: 'finding-9',
      attemptId: 'att_1',
      rubric: { id: 'claim_status', version: 1 },
      level: 'senior',
      rationale: 'unrelated',
      confidence: 0.5,
      modelVersion: 'test-model',
      promptVersion: '1',
      transcriptSpanIds: ['span-1'],
      evidenceIds: ['evidence-1'],
      kind: 'claim',
      claimId: 'claim-1',
      verdict: 'supported',
    },
  ])

  expect(composureByPressure({ findings: claim, pressureByAttemptId })).toEqual([])
})
