import type { ComposureSignal, Mode, PolicyAction } from '@closer/contracts'
import { COMPOSURE_HELD } from '@closer/contracts'

export type PressureLevel = 0 | 1 | 2 | 3

const LEVELS = [0, 1, 2, 3] as const

export const MAX_PRESSURE: PressureLevel = 3

// §4.3: "steps up only after composure has held twice in a row".
export const HOLDS_TO_STEP_UP = 2

// §4.9: Coach gives feedback and a retry after every answer, so it caps pressure low.
export const COACH_PRESSURE_CAP: PressureLevel = 1

export interface PressureState {
  level: PressureLevel
  // Consecutive *tested* turns composure has held. A turn with no composure finding tested nothing,
  // so it leaves the streak alone rather than resetting it.
  heldStreak: number
}

// Belongs to the session, not a claim or round (§4.3) — resetting it per topic would keep a session
// at level 1 forever.

// §4.3: a session starts at 1.
export const INITIAL_PRESSURE: PressureState = { level: 1, heldStreak: 0 }

// Moves that assert something untrue or invoke status sit at the top — those read as bullying when
// they land on a candidate who hasn't held anything yet.
export const PRESSURE_INTENSITY: Partial<Record<PolicyAction, 1 | 2 | 3>> = {
  TERSE_FOLLOW_UP: 1,
  INTERRUPT: 2,
  SUSTAINED_CHALLENGE: 2,
  CONSTRAINT_SHOCK: 2,
  FALSE_PREMISE: 3,
  APPEAL_TO_AUTHORITY: 3,
}

export function pressureIntensity(action: PolicyAction): 1 | 2 | 3 {
  return PRESSURE_INTENSITY[action] ?? 1
}

function toLevel(n: number): PressureLevel {
  return LEVELS[Math.min(Math.max(Math.trunc(n), 0), MAX_PRESSURE)] ?? 0
}

interface Cap {
  level: PressureLevel
  source: string
}

function bindingCap(opts: { mode: Mode; ceiling: PressureLevel }): Cap {
  // Desirable difficulty, not distress (§4.3) — do not raise or bypass this cap for a harder-feeling
  // session; both caps bind and the lower one wins.
  const modeCap = opts.mode === 'coach' ? COACH_PRESSURE_CAP : MAX_PRESSURE
  if (modeCap <= opts.ceiling) {
    return { level: modeCap, source: opts.mode === 'coach' ? 'coach mode' : 'the ladder maximum' }
  }
  return { level: opts.ceiling, source: 'the session ceiling' }
}

// `untested` (no composure finding at all) must not be treated as a failed test — that used to reset
// the streak on every arc turn and made levels 2 and 3 unreachable.
type Outcome = 'fold' | 'held' | 'unsettled' | 'untested'

function classify(signals: readonly ComposureSignal[]): Outcome {
  if (signals.length === 0) return 'untested'
  // Mixed evidence (both folded and held) reads as a fold — defers downward, same reason as the cap.
  if (signals.includes('folding') || signals.includes('fabricating')) return 'fold'
  if (signals.some((signal) => COMPOSURE_HELD.includes(signal))) return 'held'
  // Escalation and the like: composure was observed and it was not a hold.
  return 'unsettled'
}

function step(
  state: PressureState,
  outcome: Outcome,
  pressureApplied: boolean,
): { raw: PressureState; reason: string } {
  const at = `at level ${state.level}`
  switch (outcome) {
    case 'fold': {
      // A fold on a turn that applied no pressure is worth recording, but there's no dose to reduce.
      if (!pressureApplied) {
        return {
          raw: { level: state.level, heldStreak: 0 },
          reason: `folded ${at} on a turn that applied no pressure → streak reset, level unchanged`,
        }
      }
      const raw = { level: toLevel(state.level - 1), heldStreak: 0 }
      return {
        raw,
        reason:
          state.level === 0
            ? `folded ${at} → already at the floor, holding at 0`
            : `folded ${at} → ${raw.level}`,
      }
    }
    case 'held': {
      const streak = state.heldStreak + 1
      if (streak >= HOLDS_TO_STEP_UP) {
        return {
          raw: { level: toLevel(state.level + 1), heldStreak: 0 },
          reason: `held ${HOLDS_TO_STEP_UP} times in a row ${at} → ${toLevel(state.level + 1)}`,
        }
      }
      return {
        raw: { level: state.level, heldStreak: streak },
        reason: `held once ${at} → holding at ${state.level} (needs ${HOLDS_TO_STEP_UP} in a row to step up)`,
      }
    }
    case 'unsettled':
      return {
        raw: { level: state.level, heldStreak: 0 },
        reason: `composure was tested and did not hold ${at} → streak reset, holding at ${state.level}`,
      }
    case 'untested':
      return {
        raw: { level: state.level, heldStreak: state.heldStreak },
        reason: `no composure finding ${at} → nothing was tested, streak of ${state.heldStreak} stands`,
      }
  }
}

// The §4.3 dosing ladder. Pure, so pressure_level events can be recomputed from a session's answers.
export function nextPressure(
  state: PressureState,
  signals: readonly ComposureSignal[],
  opts: {
    mode: Mode
    ceiling: PressureLevel
    // Absent reads as tested (true), matching behavior from before this could distinguish the cases.
    pressureApplied?: boolean
  },
): { state: PressureState; reason: string } {
  const cap = bindingCap(opts)
  const { raw, reason } = step(state, classify(signals), opts.pressureApplied ?? true)

  const level = toLevel(Math.min(raw.level, cap.level))
  return {
    state: { level, heldStreak: raw.heldStreak },
    reason: level === raw.level ? reason : `${reason}, capped at ${level} by ${cap.source}`,
  }
}
