export * from './arm.ts'
export * from './closer.ts'
export * from './closer-full.ts'
export * from './closer-no-adaptation.ts'
export * from './fixed-sequence.ts'
export * from './generic-llm.ts'
export * from './repo-rag.ts'
export * from './model-layer.ts'

import { closerFullArm } from './closer-full.ts'
import { closerHeadlessAgentArm, closerLocalModelArm } from './model-layer.ts'
import { closerNoAdaptationArm } from './closer-no-adaptation.ts'
import { fixedSequenceArm } from './fixed-sequence.ts'
import { genericLlmArm } from './generic-llm.ts'
import { repoRagArm } from './repo-rag.ts'
import type { Arm } from './arm.ts'

// Every arm, in the order PROJECT.md §6.1 lists them — a run that quietly dropped the arm it loses
// to would still publish in full and still be dishonest.
export const ALL_ARMS: readonly Arm[] = [
  fixedSequenceArm,
  genericLlmArm,
  repoRagArm,
  closerNoAdaptationArm,
  closerFullArm,
  closerLocalModelArm,
  closerHeadlessAgentArm,
]
