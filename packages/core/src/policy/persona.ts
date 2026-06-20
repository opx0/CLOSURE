import type { PersonaId, PolicyAction } from '@closer/contracts'
import type { PressureLevel } from './pressure.ts'

export interface PersonaConfig {
  // A multiplier on an action's fit score; anything unlisted is 1. A persona is a configuration of
  // the policy, not a prompt vibe (§4.7) — the difference shows up as numbers in the plan event.
  actionWeights: Partial<Record<PolicyAction, number>>
  pressureCeiling: PressureLevel
}

export const DEFAULT_ACTION_WEIGHT = 1

export const PERSONAS: Record<PersonaId, PersonaConfig> = {
  // Warm, builds on your answers — carries the last answer forward rather than demanding proof, barely pushes.
  collaborator: {
    actionWeights: {
      PROBE_MECHANISM: 1.2,
      PROBE_TRADE_OFF: 1.2,
      CHANGE_CONSTRAINT: 1.1,
      REQUEST_EVIDENCE: 0.8,
      TERSE_FOLLOW_UP: 0.5,
      INTERRUPT: 0.4,
      SUSTAINED_CHALLENGE: 0.5,
      CONSTRAINT_SHOCK: 0.6,
      FALSE_PREMISE: 0.4,
      APPEAL_TO_AUTHORITY: 0.3,
    },
    pressureCeiling: 1,
  },
  // Assumes nothing, asks for evidence — argues from status (APPEAL_TO_AUTHORITY) least of all.
  skeptic: {
    actionWeights: {
      REQUEST_EVIDENCE: 1.8,
      SUSTAINED_CHALLENGE: 1.6,
      FALSE_PREMISE: 1.4,
      TEST_FAILURE_MODE: 1.1,
      APPEAL_TO_AUTHORITY: 0.6,
    },
    pressureCeiling: 3,
  },
  // Probes for the level above yours: what breaks, what it cost, whether it survives a changed setting.
  bar_raiser: {
    actionWeights: {
      TEST_FAILURE_MODE: 1.5,
      CHANGE_CONSTRAINT: 1.5,
      TRANSFER_TEST: 1.4,
      CONSTRAINT_SHOCK: 1.4,
      PROBE_TRADE_OFF: 1.3,
      PROBE_MECHANISM: 0.9,
    },
    pressureCeiling: 3,
  },
  // Time pressure and terse follow-ups: it says less, cuts in more, and moves on sooner.
  rusher: {
    actionWeights: {
      TERSE_FOLLOW_UP: 2,
      INTERRUPT: 1.6,
      END_TOPIC: 1.3,
      SUSTAINED_CHALLENGE: 1.1,
      REQUEST_EVIDENCE: 0.9,
      PROBE_MECHANISM: 0.8,
      PROBE_TRADE_OFF: 0.8,
    },
    pressureCeiling: 3,
  },
}

export function actionWeight(personaId: PersonaId, action: PolicyAction): number {
  return PERSONAS[personaId].actionWeights[action] ?? DEFAULT_ACTION_WEIGHT
}
