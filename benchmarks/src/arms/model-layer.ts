import { closerArm, typedPolicy } from './closer.ts'
import type { Arm } from './arm.ts'

// PROJECT.md §6.1's two extra arms. Both are `closerFullArm` with one argument changed — the
// Conductor adapter — so the comparison isolates the model layer and nothing else. ADR-011 keeps
// the Evaluator on the controlled path in every arm, including these: swapping the judge would
// make the comparison a comparison of judges.
export const closerLocalModelArm: Arm = {
  ...closerArm(
    'closer_local_model',
    'full CLOSER with the Conductor on a local llama.cpp model; the Evaluator is unchanged',
    typedPolicy,
  ),
  requiresConductor: 'closer_local_model',
}

export const closerHeadlessAgentArm: Arm = {
  ...closerArm(
    'closer_headless_agent',
    'full CLOSER with the Conductor behind a headless coding agent; the Evaluator is unchanged',
    typedPolicy,
  ),
  requiresConductor: 'closer_headless_agent',
}
