import { levelheadArm, fixedOrderPolicy } from './levelhead.ts'
import type { Arm } from './arm.ts'

// Ticket 05 §8(a). Everything full Levelhead has except the adaptation, asked in a fixed cycle instead
// of chosen from the state. If full Levelhead's gaps-per-question interval overlaps this arm's, the
// typed policy is decoration and the stop condition has fired.
export const levelheadNoAdaptationArm: Arm = levelheadArm(
  'levelhead_no_adaptation',
  'Levelhead with the typed policy replaced by a fixed action order',
  fixedOrderPolicy,
)
