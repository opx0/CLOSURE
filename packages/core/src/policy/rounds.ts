import type { Competency, PolicyAction, RoundKind } from '@closer/contracts'

export interface RoundSpec {
  // The competency order this round walks, read by `arcStage`.
  arc: readonly Competency[]
  // A lead outranks a support at the same stage — what makes two rounds on the same claim ask
  // different questions rather than the same ones in a different order.
  leads: readonly PolicyAction[]
  supports: readonly PolicyAction[]
  // §4.8: a walkthrough with nothing to walk through is a generic question wearing a round's name.
  requiresArtifact: boolean
}

// Every session has a deep dive; the other three chain onto it (§4.7).
export const DEFAULT_ROUND: RoundKind = 'project_deep_dive'

// §4.7's four rounds, each the shape of its own interrogation rather than branches in the scorer.
export const ROUND_ARCS: Record<RoundKind, RoundSpec> = {
  // §4.2's arc: what you built → how → what breaks → what you would change.
  project_deep_dive: {
    arc: ['mechanism', 'failure_modes', 'trade_offs'],
    leads: ['PROBE_MECHANISM', 'TEST_FAILURE_MODE', 'PROBE_TRADE_OFF'],
    supports: ['REQUEST_EVIDENCE', 'CHANGE_CONSTRAINT'],
    requiresArtifact: false,
  },
  // "Scale it 100×; what changes?" Constraint first, mechanism probed underneath — the reverse of
  // the deep dive, deliberately, for running both on the same claim.
  design_extension: {
    arc: ['trade_offs', 'mechanism'],
    leads: ['CHANGE_CONSTRAINT', 'CONSTRAINT_SHOCK'],
    supports: ['PROBE_MECHANISM', 'REQUEST_EVIDENCE'],
    requiresArtifact: false,
  },
  // STAR-shaped but interrogated. Failure modes are deliberately absent — a behavioral answer is
  // about ownership and cost, not what breaks.
  behavioral: {
    arc: ['mechanism', 'trade_offs'],
    leads: ['REQUEST_EVIDENCE', 'PROBE_TRADE_OFF'],
    supports: ['PROBE_MECHANISM'],
    requiresArtifact: false,
  },
  // Repository-grounded (§4.8) — evidence requested is a line of the candidate's own code.
  code_walkthrough: {
    arc: ['mechanism', 'failure_modes'],
    leads: ['PROBE_MECHANISM', 'REQUEST_EVIDENCE'],
    supports: ['TEST_FAILURE_MODE'],
    requiresArtifact: true,
  },
}

export type RoundRole = 'lead' | 'support' | 'off'

export function roundRole(round: RoundKind, action: PolicyAction): RoundRole {
  const spec = ROUND_ARCS[round]
  if (spec.leads.includes(action)) return 'lead'
  if (spec.supports.includes(action)) return 'support'
  return 'off'
}
