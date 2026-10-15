import { DEBRIEF_WALL, type Debrief } from '@levelhead/contracts'
import type { SessionView } from '../events/replay.ts'
import { competenceLane, renderCompetenceLane } from './competence.ts'
import { performanceLane, renderPerformanceLane, type PerformanceLaneInput } from './performance.ts'

export * from './competence.ts'
export * from './performance.ts'

// The two lanes arrive from two modules that name no type in common. This file is the only place
// they meet, and all it is allowed to do is put one after the other.
export interface DebriefInput {
  readonly view: SessionView
  readonly generatedAt: string
  readonly performance: PerformanceLaneInput
}

export function buildDebrief(input: DebriefInput): Debrief {
  return {
    sessionId: input.view.sessionId,
    generatedAt: input.generatedAt,
    competence: competenceLane(input.view),
    performance: performanceLane(input.performance),
    wall: DEBRIEF_WALL,
  }
}

// `quotes` maps span and evidence ids to the candidate's own words; `quotesFrom` builds it from the
// same view the debrief came from. Without it the citations render as ids rather than as nothing.
export function renderDebrief(
  debrief: Debrief,
  quotes: ReadonlyMap<string, string> = new Map(),
): string[] {
  return [
    `DEBRIEF · session ${debrief.sessionId}`,
    `Generated ${debrief.generatedAt}`,
    '',
    ...renderCompetenceLane(debrief.competence, quotes),
    '',
    ...renderPerformanceLane(debrief.performance),
  ]
}
