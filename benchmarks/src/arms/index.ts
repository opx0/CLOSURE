export * from './arm.ts'
export * from './levelhead.ts'
export * from './levelhead-full.ts'
export * from './levelhead-no-adaptation.ts'
export * from './fixed-sequence.ts'
export * from './generic-llm.ts'
export * from './repo-rag.ts'
export * from './model-layer.ts'

import { levelheadFullArm } from './levelhead-full.ts'
import { levelheadHeadlessAgentArm, levelheadLocalModelArm } from './model-layer.ts'
import { levelheadNoAdaptationArm } from './levelhead-no-adaptation.ts'
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
  levelheadNoAdaptationArm,
  levelheadFullArm,
  levelheadLocalModelArm,
  levelheadHeadlessAgentArm,
]
