import { test, expect } from 'bun:test'
import type { PolicyAction } from '@levelhead/contracts'
import { ROUND_ORDER } from '@levelhead/contracts'
import { TOPIC_ROUNDS } from '../topics/index.ts'
import { ACTIONS } from './actions.ts'
import { ROUND_ARCS, roundRole } from './rounds.ts'
import { selectAction, type Plan, type PolicyInput } from './select.ts'

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    subjectIds: ['claim-1', 'claim-2'],
    currentSubjectId: 'claim-1',
    askedCounts: {},
    coveredForCurrentSubject: [],
    recentActions: [],
    turnCount: 0,
    personaId: 'collaborator',
    mode: 'simulation',
    pressure: { level: 1, heldStreak: 0 },
    ...overrides,
  }
}

function scoreOf(plan: Plan, action: PolicyAction): number {
  const entry = plan.considered.find((candidate) => candidate.action === action)
  if (entry === undefined) throw new Error(`${action} was not considered`)
  return entry.score
}

function reasonFor(plan: Plan, action: PolicyAction): string {
  const entry = plan.considered.find((candidate) => candidate.action === action)
  if (entry === undefined) throw new Error(`${action} was not considered`)
  return entry.reason
}

test('every round can finish the arc it declares', () => {
  for (const round of ROUND_ORDER) {
    const spec = ROUND_ARCS[round]
    expect(spec.leads.length).toBeGreaterThan(0)
    for (const action of spec.leads) expect(spec.supports).not.toContain(action)
    // A stage no action probes would stall the round there forever (stage is derived from coverage).
    for (const competency of spec.arc) {
      const probers = [...spec.leads, ...spec.supports].filter(
        (action) => ACTIONS[action].probes === competency,
      )
      expect(probers.length).toBeGreaterThan(0)
    }
  }
})

test('an absent round is the deep dive', () => {
  expect(selectAction(input())).toEqual(selectAction(input({ round: 'project_deep_dive' })))
})

test('the design extension leads with the changed constraint, not with the mechanism', () => {
  const plan = selectAction(input({ round: 'design_extension' }))
  expect(plan.chosen).toBe('CHANGE_CONSTRAINT')
  expect(reasonFor(plan, 'PROBE_TRADE_OFF')).toContain('does not use this action')

  // Once the 100× question is answered, the mechanism underneath it is what supports the round.
  const underneath = selectAction(
    input({
      round: 'design_extension',
      coveredForCurrentSubject: ['trade_offs'],
      askedCounts: { 'claim-1': 1 },
      recentActions: ['CHANGE_CONSTRAINT'],
      turnCount: 1,
    }),
  )
  expect(underneath.chosen).toBe('PROBE_MECHANISM')
})

test('a constraint shock is the design extension move once the ladder allows it', () => {
  const shared = {
    coveredForCurrentSubject: ['trade_offs'],
    askedCounts: { 'claim-1': 2 },
    recentActions: ['CHANGE_CONSTRAINT'],
    turnCount: 3,
    personaId: 'bar_raiser',
    pressure: { level: 2, heldStreak: 0 },
  } as const

  const extension = selectAction(input({ ...shared, round: 'design_extension' }))
  const deepDive = selectAction(input({ ...shared, round: 'project_deep_dive' }))
  expect(extension.chosen).toBe('CONSTRAINT_SHOCK')
  // The round is a weighting, like the persona, not a switch that hides actions from other rounds.
  expect(scoreOf(extension, 'CONSTRAINT_SHOCK')).toBeGreaterThan(
    scoreOf(deepDive, 'CONSTRAINT_SHOCK'),
  )
})

test('the behavioral round opens the story, then asks what it cost and what they would change', () => {
  const story = {
    subjectIds: ['behavioral.disagreement'],
    currentSubjectId: 'behavioral.disagreement',
  }
  for (const personaId of ['collaborator', 'skeptic'] as const) {
    const opening = selectAction(input({ ...story, round: 'behavioral', personaId }))
    expect(opening.chosen).toBe('PROBE_MECHANISM')
  }

  const cost = selectAction(
    input({
      ...story,
      round: 'behavioral',
      coveredForCurrentSubject: ['mechanism'],
      askedCounts: { 'behavioral.disagreement': 1 },
      recentActions: ['PROBE_MECHANISM'],
      turnCount: 1,
    }),
  )
  expect(cost.chosen).toBe('PROBE_TRADE_OFF')

  const hindsight = selectAction(
    input({
      ...story,
      round: 'behavioral',
      coveredForCurrentSubject: ['mechanism', 'trade_offs'],
      askedCounts: { 'behavioral.disagreement': 2 },
      recentActions: ['PROBE_TRADE_OFF', 'PROBE_MECHANISM'],
      turnCount: 2,
    }),
  )
  expect(hindsight.chosen).toBe('TEST_FAILURE_MODE')
})

test('each round declares what its questions are about', () => {
  const bySubject = (subject: string) =>
    ROUND_ORDER.filter((round) => ROUND_ARCS[round].subject === subject)

  expect(bySubject('topic')).toEqual([
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
    'behavioral',
  ])
  expect(bySubject('topic')).toEqual([...TOPIC_ROUNDS])
  expect(bySubject('claim')).toEqual(['project_deep_dive', 'design_extension'])
  expect(bySubject('artifact')).toEqual(['code_walkthrough'])
})

test('a knowledge round asks questions and never asks the candidate to prove anything', () => {
  for (const round of [
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
  ] as const) {
    const plan = selectAction(input({ round, personaId: 'skeptic' }))
    expect(plan.chosen).toBe('PROBE_MECHANISM')
    expect(reasonFor(plan, 'REQUEST_EVIDENCE')).toContain('does not use this action')
  }
})

test('a topic round explains itself in terms of topics, never claims', () => {
  const plan = selectAction(
    input({
      round: 'cs_fundamentals',
      subjectIds: ['os.deadlock', 'os.paging'],
      currentSubjectId: 'os.deadlock',
      askedCounts: { 'os.deadlock': 5 },
      turnCount: 5,
      recentActions: ['PROBE_MECHANISM'],
    }),
  )

  expect(plan.chosen).toBe('END_TOPIC')
  expect(plan.nextSubjectId).toBe('os.paging')
  expect(reasonFor(plan, 'END_TOPIC')).toContain(
    'this topic has taken 5 turns and 1 planned topics are still unasked',
  )
  for (const candidate of plan.considered) expect(candidate.reason).not.toContain('claim')
})

test('the design round moves the constraint once the first sketch is on the table', () => {
  const sketched = selectAction(
    input({
      round: 'system_design',
      coveredForCurrentSubject: ['mechanism'],
      askedCounts: { 'claim-1': 1 },
      recentActions: ['PROBE_MECHANISM'],
      turnCount: 1,
    }),
  )
  expect(sketched.chosen).toBe('CHANGE_CONSTRAINT')
})

test('a fundamentals round leads with the false premise once the ladder reaches it', () => {
  const shared = {
    coveredForCurrentSubject: ['mechanism'],
    askedCounts: { 'claim-1': 1 },
    recentActions: ['PROBE_MECHANISM'],
    turnCount: 3,
    personaId: 'skeptic',
    pressure: { level: 3, heldStreak: 0 },
  } as const

  const fundamentals = selectAction(input({ ...shared, round: 'cs_fundamentals' }))
  const problems = selectAction(input({ ...shared, round: 'problem_solving' }))
  expect(fundamentals.chosen).toBe('FALSE_PREMISE')
  expect(scoreOf(fundamentals, 'FALSE_PREMISE')).toBeGreaterThan(scoreOf(problems, 'FALSE_PREMISE'))
})

test('a code walkthrough goes from what the code does to what breaks it to what it gave up', () => {
  const walk = (covered: readonly ('mechanism' | 'failure_modes')[], recent: PolicyAction[]) =>
    selectAction(
      input({
        round: 'code_walkthrough',
        artifactAvailable: true,
        coveredForCurrentSubject: covered,
        askedCounts: { 'claim-1': covered.length },
        recentActions: recent,
        turnCount: covered.length,
      }),
    ).chosen

  expect(walk([], [])).toBe('PROBE_MECHANISM')
  expect(walk(['mechanism'], ['PROBE_MECHANISM'])).toBe('TEST_FAILURE_MODE')
  expect(walk(['mechanism', 'failure_modes'], ['TEST_FAILURE_MODE', 'PROBE_MECHANISM'])).toBe(
    'PROBE_TRADE_OFF',
  )
})

test('a code walkthrough needs something to walk through', () => {
  const nothingPinned = selectAction(input({ round: 'code_walkthrough' }))
  expect(nothingPinned.chosen).toBe('END_TOPIC')
  expect(reasonFor(nothingPinned, 'PROBE_MECHANISM')).toContain('needs a pinned artifact')
  expect(reasonFor(nothingPinned, 'TERSE_FOLLOW_UP')).toContain('needs a pinned artifact')

  const pinned = selectAction(input({ round: 'code_walkthrough', artifactAvailable: true }))
  expect(ROUND_ARCS.code_walkthrough.leads).toContain(pinned.chosen)
})

test('each round opens with a move it leads with, under every persona', () => {
  const personas = ['collaborator', 'skeptic', 'bar_raiser', 'rusher'] as const
  for (const round of ROUND_ORDER) {
    for (const personaId of personas) {
      const plan = selectAction(input({ round, personaId, artifactAvailable: true }))
      expect(roundRole(round, plan.chosen)).toBe('lead')
    }
  }
})

test('the same input twice yields an identical plan in every round', () => {
  for (const round of ROUND_ORDER) {
    const shared = input({
      round,
      artifactAvailable: true,
      coveredForCurrentSubject: ['mechanism'],
      askedCounts: { 'claim-1': 2 },
      recentActions: ['REQUEST_EVIDENCE', 'PROBE_MECHANISM'],
      turnCount: 2,
      personaId: 'bar_raiser',
      pressure: { level: 2, heldStreak: 1 },
    })
    expect(selectAction(shared)).toEqual(selectAction(shared))
    expect(selectAction(shared)).toEqual(selectAction({ ...shared }))
  }
})

test('a finished claim hands the session the least-asked claim to open next', () => {
  const finished = selectAction(
    input({
      subjectIds: ['claim-1', 'claim-2', 'claim-3'],
      askedCounts: { 'claim-1': 3, 'claim-2': 2, 'claim-3': 0 },
      coveredForCurrentSubject: ['mechanism', 'failure_modes', 'trade_offs'],
      turnCount: 3,
    }),
  )
  expect(finished.chosen).toBe('END_TOPIC')
  expect(finished.nextSubjectId).toBe('claim-3')

  const exhausted = selectAction(
    input({
      subjectIds: ['claim-1', 'claim-2', 'claim-3'],
      askedCounts: { 'claim-1': 5, 'claim-2': 1, 'claim-3': 1 },
      turnCount: 5,
      recentActions: ['PROBE_MECHANISM'],
    }),
  )
  expect(exhausted.chosen).toBe('END_TOPIC')
  // Tie on turns taken: the order the claims were confirmed in breaks it, on every replay.
  expect(exhausted.nextSubjectId).toBe('claim-2')
})

test('a plan names a next claim only when there is one and the topic is closing', () => {
  const lastClaim = selectAction(
    input({
      subjectIds: ['claim-1'],
      coveredForCurrentSubject: ['mechanism', 'failure_modes', 'trade_offs'],
      askedCounts: { 'claim-1': 3 },
      turnCount: 3,
    }),
  )
  expect(lastClaim.chosen).toBe('END_TOPIC')
  expect('nextSubjectId' in lastClaim).toBe(false)

  const stillAsking = selectAction(input())
  expect(stillAsking.chosen).not.toBe('END_TOPIC')
  expect('nextSubjectId' in stillAsking).toBe(false)

  // Every other claim has had its share, so there is nowhere honest left to go.
  const allSpent = selectAction(
    input({
      subjectIds: ['claim-1', 'claim-2', 'claim-3'],
      askedCounts: { 'claim-1': 2, 'claim-2': 4, 'claim-3': 6 },
      coveredForCurrentSubject: ['mechanism', 'failure_modes', 'trade_offs'],
      turnCount: 12,
    }),
  )
  expect(allSpent.chosen).toBe('END_TOPIC')
  expect('nextSubjectId' in allSpent).toBe(false)
})
