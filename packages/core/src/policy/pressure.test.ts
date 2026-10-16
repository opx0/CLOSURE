import { test, expect } from 'bun:test'
import type { ComposureSignal } from '@levelhead/contracts'
import { INITIAL_PRESSURE, nextPressure, type PressureState } from './pressure.ts'

const simulation = { mode: 'simulation', ceiling: 3 } as const

function run(
  start: PressureState,
  turns: readonly (readonly ComposureSignal[])[],
  opts: { mode: 'simulation' | 'coach'; ceiling: 0 | 1 | 2 | 3 } = simulation,
): PressureState {
  return turns.reduce((state, signals) => nextPressure(state, signals, opts).state, start)
}

test('a session starts at level 1', () => {
  expect(INITIAL_PRESSURE).toEqual({ level: 1, heldStreak: 0 })
})

test('one hold is not enough; two in a row steps up', () => {
  const once = nextPressure(INITIAL_PRESSURE, ['holding_ground'], simulation)
  expect(once.state).toEqual({ level: 1, heldStreak: 1 })
  expect(once.reason).toBe('held once at level 1 → holding at 1 (needs 2 in a row to step up)')

  const twice = nextPressure(once.state, ['honest_yielding'], simulation)
  expect(twice.state).toEqual({ level: 2, heldStreak: 0 })
  expect(twice.reason).toBe('held 2 times in a row at level 1 → 2')
})

test('a non-held turn breaks the run', () => {
  const held = nextPressure(INITIAL_PRESSURE, ['holding_ground'], simulation)
  const escalated = nextPressure(held.state, ['escalation'], simulation)
  expect(escalated.state).toEqual({ level: 1, heldStreak: 0 })
  const heldAgain = nextPressure(escalated.state, ['holding_ground'], simulation)
  expect(heldAgain.state.level).toBe(1)
})

test('one fold steps down, and fabricating counts as folding', () => {
  const at2 = run(INITIAL_PRESSURE, [['holding_ground'], ['holding_ground']])
  expect(at2.level).toBe(2)
  const folded = nextPressure(at2, ['folding'], simulation)
  expect(folded.state).toEqual({ level: 1, heldStreak: 0 })
  expect(folded.reason).toBe('folded at level 2 → 1')
  expect(nextPressure(folded.state, ['fabricating'], simulation).state.level).toBe(0)
})

test('a mixed turn is read as a fold', () => {
  const at2 = run(INITIAL_PRESSURE, [['holding_ground'], ['holding_ground']])
  expect(nextPressure(at2, ['holding_ground', 'folding'], simulation).state.level).toBe(1)
})

test('level 0 is the floor and 3 is the ceiling', () => {
  expect(nextPressure({ level: 0, heldStreak: 0 }, ['folding'], simulation).state.level).toBe(0)
  const top = run(INITIAL_PRESSURE, Array<readonly ComposureSignal[]>(10).fill(['holding_ground']))
  expect(top.level).toBe(3)
})

test('coach mode caps the ladder low', () => {
  const coach = { mode: 'coach', ceiling: 3 } as const
  const stepUp = nextPressure({ level: 1, heldStreak: 1 }, ['holding_ground'], coach)
  expect(stepUp.state.level).toBe(1)
  expect(stepUp.reason).toBe('held 2 times in a row at level 1 → 2, capped at 1 by coach mode')
  expect(
    run(INITIAL_PRESSURE, Array<readonly ComposureSignal[]>(8).fill(['holding_ground']), coach)
      .level,
  ).toBe(1)
})

test('a persona or candidate ceiling caps the ladder too', () => {
  const capped = { mode: 'simulation', ceiling: 2 } as const
  const stepUp = nextPressure({ level: 2, heldStreak: 1 }, ['holding_ground'], capped)
  expect(stepUp.state.level).toBe(2)
  expect(stepUp.reason).toBe(
    'held 2 times in a row at level 2 → 3, capped at 2 by the session ceiling',
  )
})

test('the reason reads as an explanation a human can check', () => {
  const { reason } = nextPressure(INITIAL_PRESSURE, [], simulation)
  expect(reason).toBe('no composure finding at level 1 → nothing was tested, streak of 0 stands')
})

test('a turn that tested nothing leaves the streak alone', () => {
  // Regression: reading a no-finding arc turn as a failed test pinned real sessions at level 1.
  const held = nextPressure(INITIAL_PRESSURE, ['holding_ground'], simulation)
  const arcTurn = nextPressure(held.state, [], { ...simulation, pressureApplied: false })
  expect(arcTurn.state).toEqual({ level: 1, heldStreak: 1 })
  expect(nextPressure(arcTurn.state, ['holding_ground'], simulation).state.level).toBe(2)
})

test('only a fold under applied pressure steps down', () => {
  const at2 = run(INITIAL_PRESSURE, [['holding_ground'], ['holding_ground']])
  const unpressured = nextPressure(at2, ['folding'], { ...simulation, pressureApplied: false })
  expect(unpressured.state).toEqual({ level: 2, heldStreak: 0 })
  expect(unpressured.reason).toContain('applied no pressure')

  const pressured = nextPressure(at2, ['folding'], { ...simulation, pressureApplied: true })
  expect(pressured.state).toEqual({ level: 1, heldStreak: 0 })
})
