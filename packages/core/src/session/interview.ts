import { ROUND_ORDER, type RoleId, type RoundKind, type Topic } from '@levelhead/contracts'
import { ROUND_ARCS } from '../policy/rounds.ts'
import { roleRounds } from '../roles/packs.ts'
import { AREA_ROUND, topicById } from '../topics/index.ts'

export interface InterviewRequest {
  roleId: RoleId
  rounds?: readonly RoundKind[] | undefined
  topicIds?: readonly string[] | undefined
}

export type ResolvedInterview =
  | {
      ok: true
      rounds: RoundKind[]
      // Only when topics were named; otherwise the session plans its own.
      topics?: Topic[]
      // A round cross-questions confirmed claims, so there must be one.
      needsClaims: boolean
      // Confirmed claims are in play: questioned directly, or as the context a walkthrough ties code to.
      readsClaims: boolean
      needsSnapshot: boolean
    }
  | { ok: false; problem: 'unknown_topics'; topicIds: string[] }
  | { ok: false; problem: 'stray_topics'; topics: Topic[] }

// With no rounds named: the rounds the named topics are asked in, or else the role's first round.
export function resolveInterview(request: InterviewRequest): ResolvedInterview {
  const topics: Topic[] = []
  const unknown: string[] = []
  for (const id of request.topicIds ?? []) {
    const topic = topicById(id)
    if (topic === undefined) unknown.push(id)
    else topics.push(topic)
  }
  if (unknown.length > 0) return { ok: false, problem: 'unknown_topics', topicIds: unknown }

  const asked = new Set(topics.map((topic) => AREA_ROUND[topic.area]))
  const rounds =
    request.rounds === undefined
      ? request.topicIds === undefined
        ? roleRounds(request.roleId).slice(0, 1)
        : ROUND_ORDER.filter((round) => asked.has(round))
      : [...request.rounds]
  const stray = topics.filter((topic) => !rounds.includes(AREA_ROUND[topic.area]))
  if (stray.length > 0) return { ok: false, problem: 'stray_topics', topics: stray }

  const subjects = new Set(rounds.map((round) => ROUND_ARCS[round].subject))
  return {
    ok: true,
    rounds,
    ...(request.topicIds === undefined ? {} : { topics }),
    needsClaims: subjects.has('claim'),
    readsClaims: subjects.has('claim') || subjects.has('artifact'),
    needsSnapshot: subjects.has('artifact'),
  }
}
