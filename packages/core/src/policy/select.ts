import type { Competency, Mode, PersonaId, PolicyAction, RoundKind } from '@closer/contracts'
import { ACTIONS, ACTION_ORDER } from './actions.ts'
import { actionWeight } from './persona.ts'
import { pressureIntensity, type PressureState } from './pressure.ts'
import { DEFAULT_ROUND, ROUND_ARCS, roundRole } from './rounds.ts'

export interface PolicyInput {
  // Ids rather than full Claims, to keep the policy decoupled from the extractor's shape.
  confirmedClaimIds: readonly string[]
  currentClaimId: string | null
  askedCounts: Readonly<Record<string, number>>
  coveredForCurrentClaim: readonly Competency[]
  // Most recent first.
  recentActions: readonly PolicyAction[]
  turnCount: number
  personaId: PersonaId
  mode: Mode
  pressure: PressureState
  // Absent means the deep dive round (§4.7).
  round?: RoundKind
  // Absent reads as false, not as missing (§4.8).
  artifactAvailable?: boolean
}

export interface ConsideredAction {
  action: PolicyAction
  score: number
  reason: string
}

export interface Plan {
  considered: ConsideredAction[]
  chosen: PolicyAction
  pressureLevel: number
  // Present only alongside END_TOPIC, and only while another confirmed claim is left — closing a
  // topic and choosing what to open next are one decision.
  nextClaimId?: string
}

// Deep dive's arc (§4.2). Composure is deliberately absent — it's what pressure tests, not an arc stage.
export const ARC: readonly Competency[] = ROUND_ARCS.project_deep_dive.arc

export type ArcStage = Competency | 'closing'

function roundOf(input: PolicyInput): RoundKind {
  return input.round ?? DEFAULT_ROUND
}

export function arcStage(input: PolicyInput): ArcStage {
  if (input.currentClaimId === null) return 'closing'
  const arc = ROUND_ARCS[roundOf(input)].arc
  return arc.find((competency) => !input.coveredForCurrentClaim.includes(competency)) ?? 'closing'
}

// Exported so a caller can size a session as turns-per-claim × claims.
export const MAX_TURNS_PER_CLAIM = 4

// Gap must be wide enough that a persona weight can't reorder the round: ×1.2 vs ×0.8, lead still leads.
const LEAD_FIT = 10
const SUPPORT_FIT = 6

const PRESSURE_BASE_FIT = 3

// Grows per turn without pressure so pressure arrives on a rhythm (~every third turn, §4.3) instead
// of a flat fit that a level-1 move could never win against a stage's fit of 10.
const PRESSURE_OVERDUE_STEP = 3

const LEAD_PRESSURE_BONUS = 4

// Indexed by position in `recentActions`: repeating the last question costs more than repeating one
// from three turns back.
const REDUNDANCY_PENALTY: readonly number[] = [4, 2, 1]

interface Fit {
  fit: number
  why: string
}

function askedCount(input: PolicyInput, claimId: string | null): number {
  return claimId === null ? 0 : (input.askedCounts[claimId] ?? 0)
}

function isArcAction(action: PolicyAction): boolean {
  return !ACTIONS[action].isPressure && ACTIONS[action].probes !== null
}

function arcFit(action: PolicyAction, input: PolicyInput, stage: ArcStage, round: RoundKind): Fit {
  const probes = ACTIONS[action].probes
  if (probes !== stage) {
    return {
      fit: 0,
      why: `the ${round} arc is at ${stage}, and this probes ${probes ?? 'nothing'}`,
    }
  }
  const role = roundRole(round, action)
  // Exception: a round that leads with evidence (behavioral) has something to ask for from turn one.
  if (
    action === 'REQUEST_EVIDENCE' &&
    role !== 'lead' &&
    askedCount(input, input.currentClaimId) === 0
  ) {
    return { fit: 4, why: 'nothing has been described on this claim yet for evidence to back' }
  }
  return role === 'lead'
    ? { fit: LEAD_FIT, why: `the ${round} round leads with this while ${stage} is uncovered` }
    : { fit: SUPPORT_FIT, why: `this supports the ${round} round at the ${stage} stage` }
}

function pressureFit(action: PolicyAction, input: PolicyInput, round: RoundKind): Fit {
  const waited = turnsSincePressure(input.recentActions)
  // Scored by the move's own intensity, not the session level — otherwise all eligible moves would
  // tie and ACTION_ORDER would pick the same one forever.
  const intensity = pressureIntensity(action)
  const leads = roundRole(round, action) === 'lead'
  const lead = leads ? LEAD_PRESSURE_BONUS : 0
  return {
    fit: PRESSURE_BASE_FIT + intensity + PRESSURE_OVERDUE_STEP * waited + lead,
    why:
      `pressure interleaves the interrogation at level ${input.pressure.level}; ` +
      `intensity ${intensity}; ${waited} turns since the last pressure move` +
      (leads ? `; the ${round} round leads with it (+${lead})` : ''),
  }
}

function baseFit(action: PolicyAction, input: PolicyInput, stage: ArcStage, round: RoundKind): Fit {
  switch (action) {
    // Both outrank every arc action on purpose — drill/transfer mode should not be talked out of it.
    case 'DRILL':
      return { fit: 16, why: 'drill mode practises one gap and nothing else' }
    case 'TRANSFER_TEST':
      return { fit: 16, why: 'transfer mode retests the concept under changed constraints' }
    case 'END_TOPIC': {
      const asked = askedCount(input, input.currentClaimId)
      const unasked = input.confirmedClaimIds.filter((id) => askedCount(input, id) === 0).length
      if (stage === 'closing') {
        return input.currentClaimId === null
          ? { fit: 10, why: 'no claim is open' }
          : { fit: 10, why: `every competency the ${round} round asks about is covered` }
      }
      if (asked >= MAX_TURNS_PER_CLAIM) {
        // Grows with every turn past the cap so a claim can't hold the session forever (§4.2).
        return {
          fit: 8 + (asked - MAX_TURNS_PER_CLAIM),
          why: `this claim has taken ${asked} turns and ${unasked} confirmed claims are still unasked`,
        }
      }
      return { fit: 0, why: 'the arc on this claim is unfinished' }
    }
    default:
      // Read from the catalogue, not a second copy of the pressure moves, so a new action can't
      // silently fall through here as a pressure move.
      return ACTIONS[action].isPressure
        ? pressureFit(action, input, round)
        : arcFit(action, input, stage, round)
  }
}

function turnsSincePressure(recentActions: readonly PolicyAction[]): number {
  const at = recentActions.findIndex((action) => ACTIONS[action].isPressure)
  return at === -1 ? recentActions.length : at
}

function ineligibleBecause(
  action: PolicyAction,
  input: PolicyInput,
  round: RoundKind,
): string | null {
  if (input.mode === 'review' && action !== 'END_TOPIC') {
    return 'Review compares past attempts; it does not interrogate'
  }
  if (ROUND_ARCS[round].requiresArtifact && input.artifactAvailable !== true) {
    // Ending the topic stays available, so a round that cannot run closes instead of stalling.
    if (action !== 'END_TOPIC') return `a ${round} round needs a pinned artifact to ask about`
  }
  if (action === 'DRILL' && input.mode !== 'drill')
    return 'a drill targets a gap, and this is not drill mode'
  if (action === 'TRANSFER_TEST' && input.mode !== 'transfer') {
    return 'a transfer test needs the changed setting transfer mode supplies'
  }
  // An action a round does not use is not an option here, not merely a low-scoring one.
  if (isArcAction(action) && roundRole(round, action) === 'off') {
    return `a ${round} round does not use this action`
  }
  if (!ACTIONS[action].isPressure) return null
  if (input.turnCount === 0) return 'there is no answer yet to apply pressure to'
  // An overdue pressure move still doesn't outrank the exit once the claim has had its share (§4.3).
  if (askedCount(input, input.currentClaimId) >= MAX_TURNS_PER_CLAIM) {
    return 'this claim has taken its share of the session'
  }
  if (input.pressure.level < 1) return 'pressure is at level 0'
  if (input.recentActions[0] !== undefined && ACTIONS[input.recentActions[0]].isPressure) {
    return 'the previous action was already a pressure move'
  }
  const needs = pressureIntensity(action)
  if (needs > input.pressure.level) {
    return `this move needs pressure level ${needs} and the session is at ${input.pressure.level}`
  }
  return null
}

interface Penalty {
  penalty: number
  why: string
}

function redundancy(action: PolicyAction, recentActions: readonly PolicyAction[]): Penalty {
  let penalty = 0
  let mostRecent = -1
  for (const [index, penaltyAt] of REDUNDANCY_PENALTY.entries()) {
    if (recentActions[index] === action) {
      penalty += penaltyAt
      if (mostRecent === -1) mostRecent = index
    }
  }
  return {
    penalty,
    why: penalty === 0 ? 'not used recently' : `used ${mostRecent + 1} turn(s) ago (−${penalty})`,
  }
}

// Comparison happens over the rounded value, so a replay of the same input ranks the same way.
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function consider(
  action: PolicyAction,
  input: PolicyInput,
  stage: ArcStage,
  round: RoundKind,
): ConsideredAction & { eligible: boolean } {
  const blocked = ineligibleBecause(action, input, round)
  if (blocked !== null) {
    return { action, score: 0, reason: `ineligible — ${blocked}`, eligible: false }
  }
  const base = baseFit(action, input, stage, round)
  const weight = actionWeight(input.personaId, action)
  const penalty = redundancy(action, input.recentActions)
  return {
    action,
    score: round2(base.fit * weight - penalty.penalty),
    reason: `${base.why}; ${input.personaId} weight ×${weight}; ${penalty.why}`,
    eligible: true,
  }
}

// Least-asked confirmed claim other than the current one, ties to confirmation order; a claim past
// MAX_TURNS_PER_CLAIM is not offered.
function nextClaim(input: PolicyInput): string | null {
  let chosen: string | null = null
  let fewest = Number.POSITIVE_INFINITY
  for (const id of input.confirmedClaimIds) {
    if (id === input.currentClaimId) continue
    const asked = askedCount(input, id)
    if (asked >= MAX_TURNS_PER_CLAIM) continue
    if (asked < fewest) {
      chosen = id
      fewest = asked
    }
  }
  return chosen
}

// Deterministic: no randomness, no clock, ties broken by ACTION_ORDER — required for replay identity.
export function selectAction(input: PolicyInput): Plan {
  const round = roundOf(input)
  const stage = arcStage(input)
  const candidates = ACTION_ORDER.map((action) => consider(action, input, stage, round))
  const ranked = [...candidates].sort((a, b) => b.score - a.score)
  // END_TOPIC is never gated, so this is the floor of the ranking rather than a fallback.
  const chosen = ranked.find((candidate) => candidate.eligible)?.action ?? 'END_TOPIC'
  const moveTo = chosen === 'END_TOPIC' ? nextClaim(input) : null
  return {
    considered: ranked.map(({ action, score, reason }) => ({ action, score, reason })),
    chosen,
    pressureLevel: input.pressure.level,
    ...(moveTo === null ? {} : { nextClaimId: moveTo }),
  }
}
