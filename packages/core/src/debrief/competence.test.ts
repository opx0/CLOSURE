import { expect, test } from 'bun:test'
import type { Finding, GapEntry, Span } from '@levelhead/contracts'
import type { AttemptRecord, SessionView } from '../events/replay.ts'
import { competenceLane, quotesFrom, renderCompetenceLane } from './competence.ts'

const citations = {
  transcriptSpanIds: ['span-1'] as [string],
  evidenceIds: ['evidence-1'] as [string],
}

const claimFinding: Finding = {
  ...citations,
  id: 'finding-1',
  attemptId: 'att_1',
  rubric: { id: 'claim_status', version: 1 },
  level: 'senior',
  rationale: 'Recovery is described; double completion after resurrection is not.',
  confidence: 0.8,
  modelVersion: 'test-model',
  promptVersion: '1',
  kind: 'claim',
  claimId: 'claim-1',
  verdict: 'partially_supported',
}

const abstained: Finding = {
  ...citations,
  transcriptSpanIds: ['span-missing'],
  id: 'finding-2',
  attemptId: 'att_1',
  rubric: { id: 'claim_status', version: 1 },
  level: 'senior',
  rationale: 'The retry policy is referred to but never described.',
  confidence: 0.4,
  modelVersion: 'test-model',
  promptVersion: '1',
  kind: 'claim_abstained',
  claimId: 'claim-2',
  abstention: 'insufficient_evidence',
}

const folded: Finding = {
  ...citations,
  transcriptSpanIds: ['span-2'],
  id: 'finding-3',
  attemptId: 'att_2',
  rubric: { id: 'composure', version: 2 },
  level: 'senior',
  rationale: 'Conceded a wrong premise about lease ownership without evidence.',
  confidence: 0.9,
  modelVersion: 'test-model',
  promptVersion: '1',
  kind: 'composure',
  competency: 'composure',
  signals: ['folding'],
}

const openGap: GapEntry = {
  id: 'gap-1',
  competency: 'mechanism',
  claimId: 'claim-1',
  summary: 'Double completion after worker resurrection',
  status: 'open',
  findingIds: ['finding-1'],
  evidenceIds: ['evidence-1'],
  openedAt: '2026-09-03T10:00:00.000Z',
  lastTouchedAt: '2026-09-22T10:00:00.000Z',
  transferAttemptIds: [],
}

const spans: Span[] = [
  {
    id: 'span-1',
    sourceId: 'src-1',
    startByte: 0,
    endByte: 30,
    quoted: "I don't think we handled that.",
  },
  {
    id: 'span-2',
    sourceId: 'src-1',
    startByte: 40,
    endByte: 70,
    quoted: "Yeah, you're probably right.",
  },
]

function viewOf(over: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'ses_1',
    session: null,
    state: 'closed',
    sources: new Map(),
    claims: new Map(),
    spans: new Map(spans.map((span) => [span.id, span])),
    evidence: new Map([
      [
        'evidence-1',
        {
          id: 'evidence-1',
          subject: { kind: 'claim', claimId: 'claim-1' },
          target: { kind: 'span', spanId: 'span-1' },
          trust: 'transcript_observed',
        },
      ],
    ]),
    artifacts: new Map(),
    round: 'project_deep_dive',
    snapshot: null,
    tombstones: [],
    delivery: [],
    prosody: [],
    kinematics: [],
    confirmedClaimIds: new Set(),
    transcript: [],
    attempts: new Map<string, AttemptRecord>([
      [
        'att_1',
        { id: 'att_1', action: 'PROBE_MECHANISM', pressureLevel: 0, questionEventId: 'evt-1' },
      ],
      [
        'att_2',
        { id: 'att_2', action: 'FALSE_PREMISE', pressureLevel: 2, questionEventId: 'evt-2' },
      ],
    ]),
    handoffs: [],
    findings: [claimFinding, abstained, folded],
    gaps: new Map([['gap-1', openGap]]),
    pressureLevel: 1,
    invocations: [],
    totals: { costUsd: 0, tokens: 0 },
    closed: { reason: 'rounds_complete' },
    ...over,
  }
}

test('the lane counts abstentions and carries every finding and touched gap', () => {
  const lane = competenceLane(viewOf())

  expect(lane.findings).toHaveLength(3)
  expect(lane.abstentions).toBe(1)
  expect(lane.gaps.map((gap) => gap.id)).toEqual(['gap-1'])
})

// The level the session ended on is not the level it reached — stepping back down after a hard
// question would otherwise erase the hard question from the report.
test('pressure reached is the highest level any attempt was asked at, not the closing level', () => {
  expect(competenceLane(viewOf()).pressureReached).toBe(2)
  expect(competenceLane(viewOf({ pressureLevel: 3 })).pressureReached).toBe(3)
  expect(competenceLane(viewOf({ attempts: new Map(), pressureLevel: 0 })).pressureReached).toBe(0)
})

test('quotes resolve from span ids and from evidence ids, because findings and ledger rows cite different ones', () => {
  const quotes = quotesFrom(viewOf())

  expect(quotes.get('span-1')).toBe("I don't think we handled that.")
  expect(quotes.get('evidence-1')).toBe("I don't think we handled that.")
  expect(quotes.get('span-missing')).toBeUndefined()
})

test('every rendered finding carries its confidence and either its words or the spans it cited', () => {
  const view = viewOf()
  const rendered = renderCompetenceLane(competenceLane(view), quotesFrom(view))

  expect(rendered[0]).toBe('WHAT YOU KNOW · judged against the rubric, with the evidence')
  expect(rendered.slice(2, 14)).toEqual([
    '  Claim — partially supported · confidence 0.80 · judged at the senior bar',
    '    Recovery is described; double completion after resurrection is not.',
    "    Your words: “I don't think we handled that.”",
    '',
    '  Claim — abstained, insufficient evidence · confidence 0.40 · judged at the senior bar',
    '    The retry policy is referred to but never described.',
    '    Cited spans span-missing',
    '',
    '  Composure — did not hold · folding · confidence 0.90 · judged at the senior bar',
    '    Conceded a wrong premise about lease ownership without evidence.',
    "    Your words: “Yeah, you're probably right.”",
    '',
  ])
})

test('the lane closes on the two counts that replace a score, and prints no score', () => {
  const view = viewOf()
  const rendered = renderCompetenceLane(competenceLane(view), quotesFrom(view))

  expect(rendered.slice(-2)).toEqual([
    '  Abstentions      1 · declined to judge rather than guess, which is a result and not a failure',
    '  Pressure reached level 2 of 3',
  ])
  expect(rendered.join('\n')).not.toMatch(/%|\bscore\b|readiness|overall|\bavg\b/i)
})

test('composure that held reads as held, on the same rule the gap ledger opens a gap on', () => {
  const held: Finding = {
    ...folded,
    id: 'finding-4',
    signals: ['holding_ground', 'honest_yielding'],
  }
  const rendered = renderCompetenceLane(competenceLane(viewOf({ findings: [held] })))

  expect(rendered[2]).toBe(
    '  Composure — held · holding ground, honest yielding · confidence 0.90 · judged at the senior bar',
  )
})

test('declining to judge a competency renders and counts as an abstention', () => {
  const declined: Finding = {
    ...citations,
    id: 'finding-5',
    attemptId: 'att_1',
    rubric: { id: 'trade_offs', version: 1 },
    level: 'junior',
    rationale: 'A cost is referred to but never named.',
    confidence: 0.5,
    modelVersion: 'test-model',
    promptVersion: '2',
    kind: 'competency_abstained',
    competency: 'trade_offs',
    abstention: 'insufficient_evidence',
  }
  const view = viewOf({ findings: [declined] })
  const lane = competenceLane(view)
  const rendered = renderCompetenceLane(lane, quotesFrom(view))

  expect(lane.abstentions).toBe(1)
  expect(rendered.slice(2, 5)).toEqual([
    '  Trade-offs — abstained, insufficient evidence · confidence 0.50 · judged at the junior bar',
    '    A cost is referred to but never named.',
    "    Your words: “I don't think we handled that.”",
  ])
})

test('an empty session says so rather than rendering a blank report', () => {
  const rendered = renderCompetenceLane(
    competenceLane(
      viewOf({ findings: [], gaps: new Map(), attempts: new Map(), pressureLevel: 0 }),
    ),
  )

  expect(rendered).toContain('  No answer was evaluated in this session.')
  expect(rendered).toContain('  No gap opened or moved this session.')
  expect(rendered).toContain('  Abstentions      0')
})
