import type { Competency, PolicyAction, RoundKind } from '@levelhead/contracts'

// What a round's questions are about: a topic the interviewer picked, a résumé claim, or code from
// the pinned repository.
export type SubjectKind = 'topic' | 'claim' | 'artifact'

export interface RoundSpec {
  subject: SubjectKind
  // The competency order this round walks, read by `arcStage`.
  arc: readonly Competency[]
  // A lead outranks a support at the same stage — what makes two rounds on the same subject ask
  // different questions rather than the same ones in a different order.
  leads: readonly PolicyAction[]
  supports: readonly PolicyAction[]
}

// A policy input without a round predates rounds, when every question was a deep dive.
export const DEFAULT_ROUND: RoundKind = 'project_deep_dive'

// Each round is the shape of its own interrogation rather than branches in the scorer. The knowledge
// rounds never ask for evidence: a topic is the interviewer's question, not a claim to prove.
export const ROUND_ARCS: Record<RoundKind, RoundSpec> = {
  // The definition is where the question starts: how it works, what it costs, when it stops working.
  // A confidently wrong statement is the classic fundamentals probe, so it leads once the ladder allows.
  cs_fundamentals: {
    subject: 'topic',
    arc: ['mechanism', 'trade_offs', 'failure_modes'],
    leads: ['PROBE_MECHANISM', 'PROBE_TRADE_OFF', 'FALSE_PREMISE'],
    supports: ['TEST_FAILURE_MODE', 'CHANGE_CONSTRAINT'],
  },
  // Spoken reasoning, no code run: the approach, its time and space cost, then the inputs that break it.
  problem_solving: {
    subject: 'topic',
    arc: ['mechanism', 'trade_offs', 'failure_modes'],
    leads: ['PROBE_MECHANISM', 'PROBE_TRADE_OFF', 'TEST_FAILURE_MODE'],
    supports: ['CHANGE_CONSTRAINT'],
  },
  // Working knowledge is production knowledge: what happens underneath, what goes wrong, then why
  // you would choose it anyway.
  role_knowledge: {
    subject: 'topic',
    arc: ['mechanism', 'failure_modes', 'trade_offs'],
    leads: ['PROBE_MECHANISM', 'TEST_FAILURE_MODE'],
    supports: ['PROBE_TRADE_OFF', 'CHANGE_CONSTRAINT'],
  },
  // The candidate sketches first; the interviewer then moves the load or a requirement and asks what fails.
  system_design: {
    subject: 'topic',
    arc: ['mechanism', 'trade_offs', 'failure_modes'],
    leads: ['PROBE_MECHANISM', 'CHANGE_CONSTRAINT', 'TEST_FAILURE_MODE'],
    supports: ['PROBE_TRADE_OFF'],
  },
  // "Tell me about a time" opens the story; then which call was theirs, what it cost, and what they
  // would do differently.
  behavioral: {
    subject: 'topic',
    arc: ['mechanism', 'trade_offs', 'failure_modes'],
    leads: ['PROBE_MECHANISM', 'PROBE_TRADE_OFF'],
    supports: ['REQUEST_EVIDENCE', 'TEST_FAILURE_MODE'],
  },
  // §4.2's arc: what you built → how → what breaks → what you would change.
  project_deep_dive: {
    subject: 'claim',
    arc: ['mechanism', 'failure_modes', 'trade_offs'],
    leads: ['PROBE_MECHANISM', 'TEST_FAILURE_MODE', 'PROBE_TRADE_OFF'],
    supports: ['REQUEST_EVIDENCE', 'CHANGE_CONSTRAINT'],
  },
  // "Scale it 100×; what changes?" Constraint first, mechanism probed underneath — the reverse of
  // the deep dive, deliberately, for running both on the same claim.
  design_extension: {
    subject: 'claim',
    arc: ['trade_offs', 'mechanism'],
    leads: ['CHANGE_CONSTRAINT', 'CONSTRAINT_SHOCK'],
    supports: ['PROBE_MECHANISM', 'REQUEST_EVIDENCE'],
  },
  // Repository-grounded (§4.8) — evidence requested is a line of the candidate's own code.
  code_walkthrough: {
    subject: 'artifact',
    arc: ['mechanism', 'failure_modes', 'trade_offs'],
    leads: ['PROBE_MECHANISM', 'REQUEST_EVIDENCE'],
    supports: ['TEST_FAILURE_MODE', 'PROBE_TRADE_OFF'],
  },
}

export type RoundRole = 'lead' | 'support' | 'off'

export function roundRole(round: RoundKind, action: PolicyAction): RoundRole {
  const spec = ROUND_ARCS[round]
  if (spec.leads.includes(action)) return 'lead'
  if (spec.supports.includes(action)) return 'support'
  return 'off'
}
