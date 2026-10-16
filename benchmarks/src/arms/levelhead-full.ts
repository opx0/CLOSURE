import { levelheadArm, typedPolicy } from './levelhead.ts'
import type { Arm } from './arm.ts'

// `levelheadArm` with the typed policy; `levelhead-no-adaptation.ts` is the same function with the policy
// swapped, so ticket 05 §8(a) compares two runs differing in exactly one argument.
export const levelheadFullArm: Arm = levelheadArm(
  'levelhead_full',
  'full Levelhead: typed policy, per-turn evaluation, resolved citations, gap ledger',
  typedPolicy,
)
