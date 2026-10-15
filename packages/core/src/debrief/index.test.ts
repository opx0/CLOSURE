import { expect, test } from 'bun:test'
import {
  DEBRIEF_WALL,
  PERFORMANCE_BOUNDARY,
  type Finding,
  type PerformanceBaseline,
  type PerformanceNote,
  type Span,
} from '@levelhead/contracts'
import type { AttemptRecord, SessionView } from '../events/replay.ts'
import { buildDebrief, quotesFrom, renderDebrief, type DebriefInput } from './index.ts'

const span: Span = {
  id: 'span-1',
  sourceId: 'src-1',
  startByte: 0,
  endByte: 30,
  quoted: "I don't think we handled that.",
}

const finding: Finding = {
  id: 'finding-1',
  attemptId: 'att_1',
  rubric: { id: 'claim_status', version: 1 },
  level: 'senior',
  rationale: 'Recovery is described; double completion after resurrection is not.',
  confidence: 0.8,
  modelVersion: 'test-model',
  promptVersion: '1',
  transcriptSpanIds: ['span-1'],
  evidenceIds: ['evidence-1'],
  kind: 'claim',
  claimId: 'claim-1',
  verdict: 'partially_supported',
}

const baseline: PerformanceBaseline = {
  signal: 'articulation_rate',
  n: 6,
  median: 142,
  p25: 131,
  p75: 150,
  earliestAt: '2026-08-01T10:00:00.000Z',
  latestAt: '2026-09-15T10:00:00.000Z',
}

const note: PerformanceNote = {
  id: 'note-1',
  signal: 'articulation_rate',
  family: 'speech',
  summary: 'faster than your own usual tempo',
  trigger: { kind: 'baseline_drift', baseline, observed: 168, direction: 'above' },
  observationAttemptIds: ['att_1'],
  boundary: PERFORMANCE_BOUNDARY,
}

const view: SessionView = {
  sessionId: 'ses_1',
  session: null,
  state: 'closed',
  sources: new Map(),
  claims: new Map(),
  spans: new Map([['span-1', span]]),
  evidence: new Map(),
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
      { id: 'att_1', action: 'PROBE_MECHANISM', pressureLevel: 1, questionEventId: 'evt-1' },
    ],
  ]),
  handoffs: [],
  findings: [finding],
  gaps: new Map(),
  pressureLevel: 1,
  invocations: [],
  totals: { costUsd: 0, tokens: 0 },
  closed: { reason: 'rounds_complete' },
}

const input: DebriefInput = {
  view,
  generatedAt: '2026-09-22T18:00:00.000Z',
  performance: {
    observations: [
      {
        attemptId: 'att_1',
        signal: 'articulation_rate',
        value: 168,
        unit: 'words_per_minute',
        source: 'prosody',
        boundary: PERFORMANCE_BOUNDARY,
      },
    ],
    notes: [note],
    drills: [],
    baselines: [baseline],
  },
}

test('the debrief carries both lanes, the session it came from and the wall it declares', () => {
  const debrief = buildDebrief(input)

  expect(debrief.sessionId).toBe('ses_1')
  expect(debrief.generatedAt).toBe('2026-09-22T18:00:00.000Z')
  expect(debrief.wall).toBe(DEBRIEF_WALL)
  expect(debrief.competence.findings).toHaveLength(1)
  expect(debrief.competence.pressureReached).toBe(1)
  expect(debrief.performance.notes).toHaveLength(1)
  expect(debrief.performance.signalsWithoutBaseline).toBe(0)
})

function numberPaths(value: unknown, prefix: string): string[] {
  if (typeof value === 'number') return [prefix]
  if (Array.isArray(value))
    return value.flatMap((item, at) => numberPaths(item, `${prefix}[${at}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      numberPaths(child, prefix === '' ? key : `${prefix}.${key}`),
    )
  }
  return []
}

// The shape, not the intention. Every number in a populated debrief has to sit inside exactly one
// lane; a summary line averaging a composure finding with a words-per-minute number would have to
// land somewhere this assertion can see.
test('no number in the debrief lives outside one of the two lanes', () => {
  const debrief = buildDebrief(input)
  const paths = numberPaths(debrief, '')

  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter((path) => !/^(competence|performance)\./.test(path))).toEqual([])
  expect(Object.keys(debrief).sort()).toEqual([
    'competence',
    'generatedAt',
    'performance',
    'sessionId',
    'wall',
  ])
  expect(Object.keys(debrief.competence).sort()).toEqual([
    'abstentions',
    'findings',
    'gaps',
    'pressureReached',
  ])
  expect(Object.keys(debrief.performance).sort()).toEqual([
    'baselines',
    'drills',
    'notes',
    'observations',
    'signalsWithoutBaseline',
  ])
  // No field name is shared, so nothing can be merged by writing to "the same" key on both.
  expect(Object.keys(debrief.competence).filter((key) => key in debrief.performance)).toEqual([])
})

test('the rendered debrief heads each lane so the separation reads without being explained', () => {
  const rendered = renderDebrief(buildDebrief(input), quotesFrom(view))

  expect(rendered.slice(0, 3)).toEqual([
    'DEBRIEF · session ses_1',
    'Generated 2026-09-22T18:00:00.000Z',
    '',
  ])
  expect(rendered[3]).toBe('WHAT YOU KNOW · judged against the rubric, with the evidence')
  // The competence lane is finished before the performance lane starts. Nothing interleaves them.
  expect(rendered.indexOf('HOW YOU CAME ACROSS · measured from the recording, never judged')).toBe(
    14,
  )
  expect(rendered.slice(11, 14)).toEqual([
    '  Abstentions      0',
    '  Pressure reached level 1 of 3',
    '',
  ])
  expect(rendered.at(-1)).toBe('  ledger.')
})

test('the rendered debrief shows the finding with its words and the note with its numbers', () => {
  const rendered = renderDebrief(buildDebrief(input), quotesFrom(view)).join('\n')

  expect(rendered).toContain(
    '  Claim — partially supported · confidence 0.80 · judged at the senior bar',
  )
  expect(rendered).toContain("    Your words: “I don't think we handled that.”")
  expect(rendered).toContain(
    '    168 wpm this session, above your own baseline of 142 wpm (n=6, middle half 131–150)',
  )
  expect(rendered).not.toMatch(/%|\bscore\b|readiness|overall|composite/i)
})

// The lookup is optional because the `Debrief` itself carries ids, not text. Without it the report
// still cites something a reader can follow rather than printing a blank where evidence belongs.
test('a debrief rendered with no quote lookup cites the spans instead of leaving a blank', () => {
  const rendered = renderDebrief(buildDebrief(input))

  expect(rendered).toContain('    Cited spans span-1')
  expect(rendered.join('\n')).not.toContain('Your words')
})
