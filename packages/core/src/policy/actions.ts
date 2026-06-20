import type { Competency, PolicyAction } from '@closer/contracts'
import { isPressureAction } from '@closer/contracts'

// Declaration order is the tie-break order in `selectAction`. Arc (§4.2) first, then pressure moves
// by ascending intensity, then END_TOPIC — so a tie never ends a topic a real question could advance.
export const ACTION_ORDER: readonly PolicyAction[] = [
  'PROBE_MECHANISM',
  'REQUEST_EVIDENCE',
  'TEST_FAILURE_MODE',
  'PROBE_TRADE_OFF',
  'CHANGE_CONSTRAINT',
  'DRILL',
  'TRANSFER_TEST',
  'TERSE_FOLLOW_UP',
  'INTERRUPT',
  'SUSTAINED_CHALLENGE',
  'CONSTRAINT_SHOCK',
  'FALSE_PREMISE',
  'APPEAL_TO_AUTHORITY',
  'END_TOPIC',
]

export interface ActionSpec {
  // Null when the action isn't a probe (END_TOPIC), or takes its competency from the gap it targets
  // (DRILL, TRANSFER_TEST) rather than from the action itself.
  probes: Competency | null
  // Derived from `isPressureAction`, never re-listed — two copies of the six moves would drift.
  isPressure: boolean
  // Content the code must choose and the renderer may not invent, so anything untrue CLOSER says is
  // logged as data rather than left to the model.
  needsSeed: boolean
  // What to ask, never how the answer will be judged — the bar isn't disclosed to the thing asking.
  description: string
}

const catalogue: Record<PolicyAction, Omit<ActionSpec, 'isPressure'>> = {
  PROBE_MECHANISM: {
    probes: 'mechanism',
    needsSeed: false,
    description:
      'Ask how the thing named in the claim actually works, one level below the last answer.',
  },
  REQUEST_EVIDENCE: {
    // §4.2 puts evidence in the "how" step: what backs the mechanism the candidate just described.
    probes: 'mechanism',
    needsSeed: false,
    description: 'Ask for the specific artifact, number or detail that backs what was just said.',
  },
  TEST_FAILURE_MODE: {
    probes: 'failure_modes',
    needsSeed: false,
    description: 'Ask what breaks: the conditions under which the described design stops working.',
  },
  PROBE_TRADE_OFF: {
    probes: 'trade_offs',
    needsSeed: false,
    description: 'Ask what this choice gave up, and what the alternative would have cost.',
  },
  CHANGE_CONSTRAINT: {
    probes: 'trade_offs',
    needsSeed: true,
    description: 'Restate the problem under the seeded constraint and ask what changes.',
  },
  DRILL: {
    probes: null,
    needsSeed: true,
    description:
      'Ask one short question that requires the missing piece to be produced, not explained.',
  },
  TRANSFER_TEST: {
    probes: null,
    needsSeed: true,
    description:
      'Ask about the same concept in the seeded, different system, to see whether it generalized.',
  },
  TERSE_FOLLOW_UP: {
    probes: 'composure',
    needsSeed: false,
    description: 'Reply with two words at most — "And?", "Why?" — and add nothing else.',
  },
  INTERRUPT: {
    probes: 'composure',
    needsSeed: false,
    description: 'Cut in mid-explanation with a pointed question, then leave room to resume.',
  },
  SUSTAINED_CHALLENGE: {
    probes: 'composure',
    needsSeed: false,
    description: 'Push the same point again, unmoved by the answer just given.',
  },
  CONSTRAINT_SHOCK: {
    probes: 'composure',
    needsSeed: true,
    description: 'Impose the seeded constraint abruptly and ask whether the design still holds.',
  },
  FALSE_PREMISE: {
    probes: 'composure',
    needsSeed: true,
    description:
      'State the seeded falsehood confidently and ask the candidate to carry on from it.',
  },
  APPEAL_TO_AUTHORITY: {
    probes: 'composure',
    needsSeed: true,
    description:
      'Attribute the seeded position to a senior engineer and ask the candidate to respond.',
  },
  END_TOPIC: {
    probes: null,
    needsSeed: false,
    description: 'Close this claim out and say the topic is finished.',
  },
}

function withPressureFlag(): Record<PolicyAction, ActionSpec> {
  const specs = {} as Record<PolicyAction, ActionSpec>
  for (const action of ACTION_ORDER) {
    specs[action] = { ...catalogue[action], isPressure: isPressureAction(action) }
  }
  return specs
}

export const ACTIONS: Record<PolicyAction, ActionSpec> = withPressureFlag()
