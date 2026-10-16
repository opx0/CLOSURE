import { test, expect } from 'bun:test'
import type {
  Competency,
  ComposureSignal,
  PersonaId,
  PolicyAction,
  RoundKind,
} from '@levelhead/contracts'
import { ACTIONS } from './actions.ts'
import {
  INITIAL_PRESSURE,
  nextPressure,
  pressureIntensity,
  type PressureState,
} from './pressure.ts'
import { selectAction, type Plan } from './select.ts'

interface TurnRecord {
  claimId: string
  round: RoundKind
  level: number
  plan: Plan
}

const CLAIMS = ['claim-1', 'claim-2', 'claim-3', 'claim-4']

// Each claim is interrogated by a different round, the way §4.7 chains a loop.
const ROUNDS: readonly RoundKind[] = [
  'project_deep_dive',
  'design_extension',
  'behavioral',
  'code_walkthrough',
]

// One session, driven the way the CLI drives it: pressure state carries across claims and rounds,
// since it's a fact about the candidate, not the topic.
function walk(opts: {
  turns: number
  personaId: PersonaId
  respond: (action: PolicyAction, level: number) => readonly ComposureSignal[]
}): { turns: TurnRecord[]; pressure: PressureState } {
  const covered = new Map<string, Competency[]>(CLAIMS.map((id) => [id, []]))
  const askedCounts: Record<string, number> = {}
  const recentActions: PolicyAction[] = []
  let pressure: PressureState = INITIAL_PRESSURE
  let claimId = CLAIMS[0] as string
  const record: TurnRecord[] = []

  for (let turn = 0; turn < opts.turns; turn += 1) {
    const round = ROUNDS[CLAIMS.indexOf(claimId) % ROUNDS.length] as RoundKind
    const plan = selectAction({
      subjectIds: CLAIMS,
      currentSubjectId: claimId,
      askedCounts,
      coveredForCurrentSubject: covered.get(claimId) ?? [],
      recentActions,
      turnCount: turn,
      personaId: opts.personaId,
      mode: 'simulation',
      pressure,
      round,
      artifactAvailable: true,
    })
    record.push({ claimId, round, level: pressure.level, plan })

    if (plan.chosen === 'END_TOPIC') {
      if (plan.nextSubjectId === undefined) break
      claimId = plan.nextSubjectId
      continue
    }

    askedCounts[claimId] = (askedCounts[claimId] ?? 0) + 1
    recentActions.unshift(plan.chosen)
    const probes = ACTIONS[plan.chosen].probes
    const seen = covered.get(claimId) ?? []
    if (probes !== null && probes !== 'composure' && !seen.includes(probes)) seen.push(probes)
    pressure = nextPressure(pressure, opts.respond(plan.chosen, pressure.level), {
      mode: 'simulation',
      ceiling: 3,
      pressureApplied: ACTIONS[plan.chosen].isPressure,
    }).state
  }
  return { turns: record, pressure }
}

function eligible(plan: Plan, action: PolicyAction): boolean {
  const entry = plan.considered.find((candidate) => candidate.action === action)
  if (entry === undefined) throw new Error(`${action} was not considered`)
  return !entry.reason.startsWith('ineligible')
}

function firstAtLevel(turns: readonly TurnRecord[], level: number): TurnRecord {
  const found = turns.find((record) => record.level === level)
  if (found === undefined) throw new Error(`the session never reached level ${level}`)
  return found
}

const holdsUnderPressure = (action: PolicyAction): readonly ComposureSignal[] =>
  ACTIONS[action].isPressure ? ['holding_ground'] : []

test('a candidate who keeps holding reaches the levels the harsh moves live at', () => {
  const { turns, pressure } = walk({
    turns: 30,
    personaId: 'skeptic',
    respond: holdsUnderPressure,
  })

  // Regression: arc turns in between used to erase the streak, making levels 2 and 3 unreachable.
  const offered = (level: number, action: PolicyAction): boolean =>
    turns.some((record) => record.level === level && eligible(record.plan, action))
  const neverBelow = (level: number, action: PolicyAction): boolean =>
    turns.filter((record) => record.level < level).every((record) => !eligible(record.plan, action))

  expect(offered(2, 'INTERRUPT')).toBe(true)
  expect(neverBelow(2, 'INTERRUPT')).toBe(true)
  expect(offered(3, 'FALSE_PREMISE')).toBe(true)
  expect(offered(3, 'APPEAL_TO_AUTHORITY')).toBe(true)
  expect(neverBelow(3, 'FALSE_PREMISE')).toBe(true)

  // Eligible is not enough: §4.3's ladder is pointless if the gentlest move wins every tie for ever.
  const applied = turns
    .map((record) => record.plan.chosen)
    .filter((action) => ACTIONS[action].isPressure)
  expect(applied.some((action) => pressureIntensity(action) >= 2)).toBe(true)
  expect(applied.some((action) => pressureIntensity(action) === 3)).toBe(true)

  // A fold is still a step down, from wherever the session got to.
  const folded = nextPressure(pressure, ['folding'], {
    mode: 'simulation',
    ceiling: 3,
    pressureApplied: true,
  })
  expect(pressure.level - folded.state.level).toBe(1)
})

test('the streak that earns a level is carried across claims and rounds', () => {
  const { turns } = walk({ turns: 30, personaId: 'skeptic', respond: holdsUnderPressure })

  const atTwo = firstAtLevel(turns, 2)
  const atThree = firstAtLevel(turns, 3)
  const first = turns[0] as TurnRecord
  // Nothing here is a claim's property: the session steps up on a later claim/round on earlier composure.
  expect(atTwo.claimId).not.toBe(first.claimId)
  expect(new Set(turns.map((record) => record.claimId)).size).toBeGreaterThan(2)
  expect(new Set(turns.map((record) => record.round)).size).toBeGreaterThan(1)
  expect(turns.indexOf(atThree)).toBeGreaterThan(turns.indexOf(atTwo))
})

test('a session that folds under pressure does not climb', () => {
  const { turns, pressure } = walk({
    turns: 30,
    personaId: 'skeptic',
    respond: (action) => (ACTIONS[action].isPressure ? ['folding'] : []),
  })
  expect(pressure.level).toBe(0)
  expect(turns.every((record) => record.level <= 1)).toBe(true)
  // At level 0 nothing pressures anybody, which is the ladder working, not failing.
  expect(
    turns.every((record) => !ACTIONS[record.plan.chosen].isPressure || record.level >= 1),
  ).toBe(true)
})

test('the walk is deterministic: the same session replays move for move', () => {
  const again = () => walk({ turns: 20, personaId: 'bar_raiser', respond: holdsUnderPressure })
  expect(again().turns.map((record) => record.plan.chosen)).toEqual(
    again().turns.map((record) => record.plan.chosen),
  )
})
