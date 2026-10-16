import {
  LEVEL_ORDER,
  ROUND_ORDER,
  type Level,
  type RoleId,
  type RoundKind,
  type Topic,
  type TopicArea,
} from '@levelhead/contracts'
import { roleAreas } from '../roles/packs.ts'
import { TOPICS } from './catalog/index.ts'

export const AREA_ROUND: Readonly<Record<TopicArea, RoundKind>> = {
  os: 'cs_fundamentals',
  dbms: 'cs_fundamentals',
  networks: 'cs_fundamentals',
  oop: 'cs_fundamentals',
  dsa: 'problem_solving',
  system_design: 'system_design',
  web: 'role_knowledge',
  backend: 'role_knowledge',
  ml: 'role_knowledge',
  data: 'role_knowledge',
  devops: 'role_knowledge',
  behavioral: 'behavioral',
}

const TOPIC_ROUND_SET: ReadonlySet<RoundKind> = new Set(Object.values(AREA_ROUND))

export const TOPIC_ROUNDS: readonly RoundKind[] = ROUND_ORDER.filter((round) =>
  TOPIC_ROUND_SET.has(round),
)

export interface TopicPlanInput {
  roleId: RoleId
  round: RoundKind
  level: Level
  count: number
  seed: string
  askedBefore?: readonly string[]
  exclude?: readonly string[]
}

// Role knowledge is the one round a role narrows: it draws only the areas the role's pack names.
export function topicSuitsRole(topic: Pick<Topic, 'area'>, roleId: RoleId): boolean {
  return AREA_ROUND[topic.area] !== 'role_knowledge' || roleAreas(roleId).includes(topic.area)
}

export function planTopics(input: TopicPlanInput): Topic[] {
  const ceiling = LEVEL_ORDER.indexOf(input.level)
  const excluded = new Set(input.exclude ?? [])
  const eligible = TOPICS.filter(
    (topic) =>
      AREA_ROUND[topic.area] === input.round &&
      topicSuitsRole(topic, input.roleId) &&
      LEVEL_ORDER.indexOf(topic.minLevel) <= ceiling &&
      !excluded.has(topic.id),
  )
  const asked = new Set(input.askedBefore ?? [])
  const fresh = eligible.filter((topic) => !asked.has(topic.id))
  const stale = eligible.filter((topic) => asked.has(topic.id))
  return [...interleave(fresh, input.seed), ...interleave(stale, input.seed)].slice(
    0,
    Math.max(0, input.count),
  )
}

function interleave(topics: readonly Topic[], seed: string): Topic[] {
  const byArea = new Map<TopicArea, Topic[]>()
  for (const topic of topics) byArea.set(topic.area, [...(byArea.get(topic.area) ?? []), topic])
  const queues = rotate(
    [...byArea].map(([area, group]) => rotate(group, hash(`${seed}:${area}`))),
    hash(seed),
  )
  const order: Topic[] = []
  for (let index = 0; order.length < topics.length; index += 1) {
    for (const queue of queues) {
      const topic = queue[index]
      if (topic !== undefined) order.push(topic)
    }
  }
  return order
}

function rotate<T>(items: readonly T[], by: number): T[] {
  if (items.length === 0) return []
  const start = by % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193)
  }
  // FNV-1a leaves the low bits, the ones `%` reads, barely mixed; the murmur3 finaliser spreads them.
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  return (value ^ (value >>> 16)) >>> 0
}
