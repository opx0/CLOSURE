import { levelheadArm, typedPolicy } from './levelhead.ts'
import type { Arm } from './arm.ts'

// PROJECT.md §6.1's two extra arms. Both are `levelheadFullArm` with one argument changed — the
// Conductor adapter — so the comparison isolates the model layer and nothing else. ADR-011 keeps
// the Evaluator on the controlled path in every arm, including these: swapping the judge would
// make the comparison a comparison of judges.
export const levelheadLocalModelArm: Arm = {
  ...levelheadArm(
    'levelhead_local_model',
    'full Levelhead with the Conductor on a local llama.cpp model; the Evaluator is unchanged',
    typedPolicy,
  ),
  requiresConductor: 'levelhead_local_model',
}

export const levelheadHeadlessAgentArm: Arm = {
  ...levelheadArm(
    'levelhead_headless_agent',
    'full Levelhead with the Conductor behind a headless coding agent; the Evaluator is unchanged',
    typedPolicy,
  ),
  requiresConductor: 'levelhead_headless_agent',
}
