import { test, expect } from 'bun:test'
import type { PolicyAction } from '@closer/contracts'
import { ACTIONS } from './actions.ts'
import { selectAction, type PolicyInput } from './select.ts'

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    confirmedClaimIds: ['claim-1', 'claim-2'],
    currentClaimId: 'claim-1',
    askedCounts: {},
    coveredForCurrentClaim: [],
    recentActions: [],
    turnCount: 0,
    personaId: 'collaborator',
    mode: 'simulation',
    pressure: { level: 1, heldStreak: 0 },
    ...overrides,
  }
}

function scoreOf(plan: ReturnType<typeof selectAction>, action: PolicyAction): number {
  const entry = plan.considered.find((candidate) => candidate.action === action)
  if (entry === undefined) throw new Error(`${action} was not considered`)
  return entry.score
}

function reasonFor(plan: ReturnType<typeof selectAction>, action: PolicyAction): string {
  const entry = plan.considered.find((candidate) => candidate.action === action)
  if (entry === undefined) throw new Error(`${action} was not considered`)
  return entry.reason
}

test('a fresh claim follows the arc: what, then what breaks, then what you would change', () => {
  expect(selectAction(input()).chosen).toBe('PROBE_MECHANISM')

  expect(
    selectAction(
      input({
        coveredForCurrentClaim: ['mechanism'],
        askedCounts: { 'claim-1': 1 },
        recentActions: ['PROBE_MECHANISM'],
        turnCount: 1,
      }),
    ).chosen,
  ).toBe('TEST_FAILURE_MODE')

  expect(
    selectAction(
      input({
        coveredForCurrentClaim: ['mechanism', 'failure_modes'],
        askedCounts: { 'claim-1': 2 },
        recentActions: ['TEST_FAILURE_MODE', 'PROBE_MECHANISM'],
        turnCount: 2,
      }),
    ).chosen,
  ).toBe('PROBE_TRADE_OFF')

  expect(
    selectAction(
      input({
        coveredForCurrentClaim: ['mechanism', 'failure_modes', 'trade_offs'],
        askedCounts: { 'claim-1': 3 },
        recentActions: ['PROBE_TRADE_OFF'],
        turnCount: 3,
      }),
    ).chosen,
  ).toBe('END_TOPIC')
})

test('evidence follows the first description of the mechanism', () => {
  const opening = selectAction(input({ personaId: 'skeptic' }))
  const afterOneAnswer = selectAction(
    input({
      personaId: 'skeptic',
      askedCounts: { 'claim-1': 1 },
      recentActions: ['PROBE_MECHANISM'],
      turnCount: 1,
    }),
  )
  expect(opening.chosen).toBe('PROBE_MECHANISM')
  expect(afterOneAnswer.chosen).toBe('REQUEST_EVIDENCE')
})

test('the same input twice yields an identical plan', () => {
  const shared = input({
    coveredForCurrentClaim: ['mechanism'],
    askedCounts: { 'claim-1': 2 },
    recentActions: ['REQUEST_EVIDENCE', 'PROBE_MECHANISM'],
    turnCount: 2,
    personaId: 'bar_raiser',
    pressure: { level: 2, heldStreak: 1 },
  })
  expect(selectAction(shared)).toEqual(selectAction(shared))
  expect(selectAction(shared)).toEqual(selectAction({ ...shared }))
})

test('every considered action carries a reason, and the plan reports the level it ran at', () => {
  const plan = selectAction(input({ pressure: { level: 2, heldStreak: 0 } }))
  expect(plan.considered.length).toBe(Object.keys(ACTIONS).length)
  for (const candidate of plan.considered) expect(candidate.reason.length).toBeGreaterThan(0)
  expect(plan.pressureLevel).toBe(2)
})

test('pressure needs a level of at least 1 and an answer to react to', () => {
  const noAnswerYet = selectAction(
    input({ personaId: 'rusher', pressure: { level: 3, heldStreak: 0 } }),
  )
  expect(ACTIONS[noAnswerYet.chosen].isPressure).toBe(false)
  expect(reasonFor(noAnswerYet, 'TERSE_FOLLOW_UP')).toContain('no answer yet')

  const zeroed = selectAction(
    input({
      personaId: 'rusher',
      turnCount: 4,
      recentActions: ['PROBE_MECHANISM'],
      pressure: { level: 0, heldStreak: 0 },
    }),
  )
  expect(ACTIONS[zeroed.chosen].isPressure).toBe(false)
  expect(reasonFor(zeroed, 'TERSE_FOLLOW_UP')).toContain('level 0')
})

test('a pressure move never fires twice in a row', () => {
  const base = {
    personaId: 'rusher',
    turnCount: 5,
    askedCounts: { 'claim-1': 2 },
    coveredForCurrentClaim: ['mechanism'],
    pressure: { level: 3, heldStreak: 0 },
  } as const

  const afterAnArcQuestion = selectAction(input({ ...base, recentActions: ['PROBE_MECHANISM'] }))
  expect(ACTIONS[afterAnArcQuestion.chosen].isPressure).toBe(true)

  const afterPressure = selectAction(input({ ...base, recentActions: [afterAnArcQuestion.chosen] }))
  expect(ACTIONS[afterPressure.chosen].isPressure).toBe(false)
  expect(reasonFor(afterPressure, 'INTERRUPT')).toContain(
    'previous action was already a pressure move',
  )
})

test('the harshest moves are held back until the ladder has climbed', () => {
  const atOne = selectAction(
    input({
      personaId: 'skeptic',
      turnCount: 3,
      recentActions: ['PROBE_MECHANISM'],
      pressure: { level: 1, heldStreak: 0 },
    }),
  )
  expect(reasonFor(atOne, 'FALSE_PREMISE')).toContain('needs pressure level 3')
  expect(reasonFor(atOne, 'TERSE_FOLLOW_UP')).not.toContain('ineligible')
})

test('a repeated action is penalised', () => {
  const fresh = selectAction(input({ askedCounts: { 'claim-1': 1 }, turnCount: 1 }))
  const repeated = selectAction(
    input({ askedCounts: { 'claim-1': 1 }, turnCount: 1, recentActions: ['PROBE_MECHANISM'] }),
  )
  expect(scoreOf(repeated, 'PROBE_MECHANISM')).toBeLessThan(scoreOf(fresh, 'PROBE_MECHANISM'))
  expect(reasonFor(repeated, 'PROBE_MECHANISM')).toContain('used 1 turn(s) ago')
})

test('a claim that has taken its share of the session gives way to the ones not yet asked', () => {
  const chosen = selectAction(
    input({
      personaId: 'rusher',
      askedCounts: { 'claim-1': 5 },
      turnCount: 5,
      recentActions: ['REQUEST_EVIDENCE', 'PROBE_MECHANISM'],
    }),
  )
  expect(chosen.chosen).toBe('END_TOPIC')
  expect(reasonFor(chosen, 'END_TOPIC')).toContain('1 confirmed claims are still unasked')
})

test('drill and transfer actions belong to their modes', () => {
  expect(reasonFor(selectAction(input()), 'DRILL')).toContain('not drill mode')
  expect(selectAction(input({ mode: 'drill' })).chosen).toBe('DRILL')
  expect(selectAction(input({ mode: 'transfer' })).chosen).toBe('TRANSFER_TEST')
})

test('review mode does not interrogate', () => {
  const plan = selectAction(input({ mode: 'review' }))
  expect(plan.chosen).toBe('END_TOPIC')
  expect(reasonFor(plan, 'PROBE_MECHANISM')).toContain('does not interrogate')
})

test('personas differ by weights, not by tone', () => {
  const shared = {
    askedCounts: { 'claim-1': 1 },
    turnCount: 1,
    recentActions: ['PROBE_MECHANISM'],
  } as const
  expect(selectAction(input({ ...shared, personaId: 'skeptic' })).chosen).toBe('REQUEST_EVIDENCE')
  expect(selectAction(input({ ...shared, personaId: 'collaborator' })).chosen).toBe(
    'PROBE_MECHANISM',
  )
})

test('pressure eventually interleaves the arc rather than never firing', () => {
  // A flat pressure fit could never outrank an arc stage, so the loop would run to completion
  // having applied none (§4.3, §10).
  const chosen = selectAction(
    input({
      currentClaimId: 'claim-1',
      askedCounts: { 'claim-1': 3 },
      turnCount: 3,
      recentActions: ['PROBE_TRADE_OFF', 'TEST_FAILURE_MODE', 'PROBE_MECHANISM'],
      coveredForCurrentClaim: ['mechanism', 'failure_modes'],
      personaId: 'skeptic',
    }),
  )

  expect(ACTIONS[chosen.chosen].isPressure).toBe(true)
  // Level 1 admits only the gentlest move — the terse follow-up, not a false premise.
  expect(chosen.chosen).toBe('TERSE_FOLLOW_UP')
})
