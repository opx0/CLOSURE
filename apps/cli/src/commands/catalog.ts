import {
  ACTIONS,
  AREA_ROUND,
  INTERVIEW_FORMATS,
  PERSONAS,
  PRESSURE_INTENSITY,
  ROLE_PACKS,
  RUBRIC_V1,
  TOPICS,
  TOPIC_ROUNDS,
  topicSuitsRole,
  validationNotice,
} from '@levelhead/core'
import type { RoundKind, Topic, TopicArea } from '@levelhead/contracts'
import { dim, heading, line } from '../terminal.ts'

function words(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

export const ROUND_LABEL: Record<RoundKind, string> = {
  cs_fundamentals: 'CS fundamentals',
  problem_solving: 'problem solving',
  role_knowledge: 'role knowledge',
  system_design: 'system design',
  behavioral: 'behavioral',
  project_deep_dive: 'project deep dive',
  design_extension: 'design extension',
  code_walkthrough: 'code walkthrough',
}

export function topicLabel(topic: Pick<Topic, 'area' | 'title'>): string {
  return `${words(topic.area)} · ${topic.title}`
}

export function roles(): number {
  heading('role packs')
  for (const pack of ROLE_PACKS) {
    line(`  ${pack.id}  ${pack.label}`)
    dim(`    ${validationNotice(pack.id)}`)
    dim(`    rounds: ${pack.defaultRounds.join(', ')} · default level ${pack.defaultLevel}`)
    dim(`    role knowledge draws on: ${pack.areas.map(words).join(', ')}`)
    dim(`    vocabulary: ${pack.vocabulary.join(', ')}`)
  }
  line('')
  dim('  a role pack is data. Whether anyone has measured agreement for it is stated, not implied.')
  return 0
}

function isArea(value: string): value is TopicArea {
  return Object.hasOwn(AREA_ROUND, value)
}

// Never the false premise, the twist or the expected concepts: that is the interviewer's side.
export function topics(argv: readonly string[]): number {
  const roleId = flag(argv, 'role')
  const pack = roleId === undefined ? undefined : ROLE_PACKS.find((known) => known.id === roleId)
  if (roleId !== undefined && pack === undefined) {
    line(`no role pack named ${roleId} — run: levelhead roles`)
    return 1
  }
  const area = flag(argv, 'area')
  if (area !== undefined && !isArea(area)) {
    line(`no topic area named ${area} — one of: ${Object.keys(AREA_ROUND).join(', ')}`)
    return 1
  }

  const listed = TOPICS.filter(
    (topic) =>
      (area === undefined || topic.area === area) &&
      (pack === undefined || topicSuitsRole(topic, pack.id)),
  )
  const width = Math.max(0, ...listed.map((topic) => topic.id.length))

  heading(pack === undefined ? 'topics' : `topics · ${pack.label}`)
  for (const round of TOPIC_ROUNDS) {
    const inRound = listed.filter((topic) => AREA_ROUND[topic.area] === round)
    if (inRound.length === 0) continue
    line('')
    line(`  ${ROUND_LABEL[round]}`)
    for (const topic of inRound) {
      line(`    ${topic.id.padEnd(width)}  ${topicLabel(topic)} · from ${topic.minLevel}`)
    }
  }
  line('')
  dim('  the interviewer picks from these; ask for some by id: levelhead session --topics <id,id>')
  return 0
}

export function formats(): number {
  heading('interview formats')
  for (const format of INTERVIEW_FORMATS) {
    line(`  ${format.id}  ${format.label}`)
    for (const round of format.rounds) {
      dim(
        `    ${ROUND_LABEL[round.kind]} · ${words(round.personaId)} · ${round.turns} turns · pressure ≤ ${round.pressureCeiling}`,
      )
      dim(`      ${round.emphasis}`)
    }
    dim(`    ${format.disclaimer}`)
    for (const source of format.derivedFrom) {
      dim(`      ${source.publisher}: ${source.url} (read ${source.readOn})`)
    }
  }
  return 0
}

export function policy(): number {
  heading('policy actions — chosen by code, phrased by the model')
  for (const [action, spec] of Object.entries(ACTIONS)) {
    const intensity = PRESSURE_INTENSITY[action as keyof typeof ACTIONS]
    line(`  ${action}`)
    dim(
      `    ${spec.probes === null ? 'no competency' : `probes ${words(spec.probes)}`}${spec.isPressure ? ` · pressure move, intensity ${intensity}` : ''}`,
    )
    dim(`    ${spec.description}`)
  }

  heading('personas — weights on those actions, not prompt vibes')
  for (const [id, config] of Object.entries(PERSONAS)) {
    line(`  ${id} (caps pressure at ${config.pressureCeiling})`)
    const weights = Object.entries(config.actionWeights).sort(([, a], [, b]) => b - a)
    for (const [action, weight] of weights) dim(`    ×${weight} ${action}`)
  }

  heading('rubric v1')
  for (const rubric of RUBRIC_V1) {
    line(`  ${rubric.ref.id} v${rubric.ref.version}`)
    for (const anchor of rubric.anchors) dim(`    ${anchor.level}: ${anchor.expectation}`)
  }
  return 0
}
