import { test, expect } from 'bun:test'
import { IllegalTransitionError, canTransition, transition } from './machine.ts'

test('a turn walks selecting → asking → awaiting_answer → observing → evaluating → selecting', () => {
  let state = transition('selecting', 'action_selected')
  expect(state).toBe('asking')
  state = transition(state, 'question_rendered')
  expect(state).toBe('awaiting_answer')
  state = transition(state, 'answer_received')
  expect(state).toBe('observing')
  state = transition(state, 'observations_recorded')
  expect(state).toBe('evaluating')
  expect(transition(state, 'evaluation_produced')).toBe('selecting')
})

test('a drill is entered from evaluating and rejoins at observing', () => {
  expect(transition('evaluating', 'drill_started')).toBe('drilling')
  expect(transition('drilling', 'answer_received')).toBe('observing')
})

test('an illegal transition throws a named error', () => {
  expect(() => transition('selecting', 'answer_received')).toThrow(IllegalTransitionError)
  expect(() => transition('awaiting_answer', 'evaluation_produced')).toThrow(
    'illegal transition: cannot evaluation_produced from awaiting_answer',
  )
})

test('closed is terminal', () => {
  expect(transition('observing', 'session_closed')).toBe('closed')
  expect(canTransition('closed', 'action_selected')).toBe(false)
  expect(() => transition('closed', 'session_closed')).toThrow(IllegalTransitionError)
})
