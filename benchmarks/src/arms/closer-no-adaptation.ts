import { closerArm, fixedOrderPolicy } from './closer.ts'
import type { Arm } from './arm.ts'

// Ticket 05 §8(a). Everything full CLOSER has except the adaptation, asked in a fixed cycle instead
// of chosen from the state. If full CLOSER's gaps-per-question interval overlaps this arm's, the
// typed policy is decoration and the stop condition has fired.
export const closerNoAdaptationArm: Arm = closerArm(
  'closer_no_adaptation',
  'CLOSER with the typed policy replaced by a fixed action order',
  fixedOrderPolicy,
)
