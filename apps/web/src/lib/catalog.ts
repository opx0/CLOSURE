import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import type { TopicsResponse } from '../api/types.ts'

export type Catalog = TopicsResponse
export type Role = TopicsResponse['roles'][number]
export type TopicSummary = TopicsResponse['topics'][number]
export type RoundKind = Role['defaultRounds'][number]
export type TopicArea = TopicSummary['area']
export type Level = Role['defaultLevel']
export type SubjectKind = Catalog['rounds'][number]['subject']

export const ROUND_LABEL: Record<RoundKind, string> = {
  cs_fundamentals: 'CS fundamentals',
  problem_solving: 'Problem solving',
  role_knowledge: 'Role knowledge',
  system_design: 'System design',
  behavioral: 'Behavioral',
  project_deep_dive: 'Project deep dive',
  design_extension: 'Design extension',
  code_walkthrough: 'Code walkthrough',
}

export const ROUND_BLURB: Record<RoundKind, string> = {
  cs_fundamentals: 'Operating systems, databases, networks and OOP.',
  problem_solving: 'Reason through a DSA problem out loud. No code to run.',
  role_knowledge: 'The working knowledge your role leans on every day.',
  system_design: 'Design a system and give every box a reason and a cost.',
  behavioral: 'A time you owned a decision, and what it cost.',
  project_deep_dive: 'The layer beneath a line on your résumé.',
  design_extension: 'Your own design, pushed to a new scale or constraint.',
  code_walkthrough: 'Real files from your project, opened and explained.',
}

export const AREA_LABEL: Record<TopicArea, string> = {
  os: 'OS',
  dbms: 'DBMS',
  networks: 'Networks',
  oop: 'OOP',
  dsa: 'DSA',
  system_design: 'System design',
  web: 'Web',
  backend: 'Backend',
  ml: 'ML',
  data: 'Data',
  devops: 'DevOps',
  behavioral: 'Behavioral',
}

export const LEVEL_LABEL: Record<Level, string> = {
  junior: 'junior · new grad / intern',
  mid: 'mid',
  senior: 'senior',
  staff: 'staff',
}

export function roundsAbout(catalog: Catalog, subject: SubjectKind): RoundKind[] {
  return catalog.rounds.filter((round) => round.subject === subject).map((round) => round.kind)
}

export function subjectOf(catalog: Catalog, round: RoundKind): SubjectKind | undefined {
  return catalog.rounds.find((entry) => entry.kind === round)?.subject
}

export function isRound(catalog: Catalog, value: string): value is RoundKind {
  return catalog.rounds.some((round) => round.kind === value)
}

export function inRoundOrder(catalog: Catalog, rounds: Iterable<RoundKind>): RoundKind[] {
  const wanted = new Set(rounds)
  return catalog.rounds.map((round) => round.kind).filter((round) => wanted.has(round))
}

export function topicLabel(topic: Pick<TopicSummary, 'area' | 'title'>): string {
  return `${AREA_LABEL[topic.area]} · ${topic.title}`
}

export function roleAreasLabel(role: Role): string {
  return role.areas.map((area) => AREA_LABEL[area]).join(' · ')
}

export function topicsFor(
  catalog: Catalog,
  role: Role,
  round: RoundKind,
  level: Level,
): TopicSummary[] {
  const ceiling = catalog.levels.indexOf(level)
  const asked = new Set(role.topicIds)
  return catalog.topics.filter(
    (topic) =>
      topic.round === round &&
      asked.has(topic.id) &&
      catalog.levels.indexOf(topic.minLevel) <= ceiling,
  )
}

export function useTopicCatalog() {
  return useQuery({ queryKey: ['topics'], queryFn: api.topics, staleTime: Infinity })
}

export function useTopicById(): (id: string | undefined) => TopicSummary | undefined {
  const catalog = useTopicCatalog()
  return (id) =>
    id === undefined ? undefined : catalog.data?.topics.find((topic) => topic.id === id)
}
