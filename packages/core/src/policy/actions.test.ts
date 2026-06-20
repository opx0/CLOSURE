import { test, expect } from 'bun:test'
import { PRESSURE_ACTIONS, isPressureAction, type PolicyAction } from '@closer/contracts'
import { ACTIONS, ACTION_ORDER } from './actions.ts'
import { PRESSURE_INTENSITY } from './pressure.ts'

test('ACTION_ORDER lists every action exactly once', () => {
  const catalogued = Object.keys(ACTIONS) as PolicyAction[]
  expect([...ACTION_ORDER].sort()).toEqual([...catalogued].sort())
  expect(new Set(ACTION_ORDER).size).toBe(ACTION_ORDER.length)
})

test('the pressure flag comes from contracts, not from a second list', () => {
  for (const action of ACTION_ORDER) {
    expect(ACTIONS[action].isPressure).toBe(isPressureAction(action))
  }
})

test('every pressure move has a rung on the ladder', () => {
  for (const action of PRESSURE_ACTIONS) {
    expect(PRESSURE_INTENSITY[action]).toBeDefined()
  }
})

test('a seeded action is one whose content code must choose', () => {
  expect(ACTIONS.FALSE_PREMISE.needsSeed).toBe(true)
  expect(ACTIONS.CONSTRAINT_SHOCK.needsSeed).toBe(true)
  expect(ACTIONS.PROBE_MECHANISM.needsSeed).toBe(false)
})
