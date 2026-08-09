import { closerArm, typedPolicy } from './closer.ts'
import type { Arm } from './arm.ts'

// `closerArm` with the typed policy; `closer-no-adaptation.ts` is the same function with the policy
// swapped, so ticket 05 §8(a) compares two runs differing in exactly one argument.
export const closerFullArm: Arm = closerArm(
  'closer_full',
  'full CLOSER: typed policy, per-turn evaluation, resolved citations, gap ledger',
  typedPolicy,
)
