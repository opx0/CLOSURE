import {
  ACTIONS,
  INTERVIEW_FORMATS,
  PERSONAS,
  PRESSURE_INTENSITY,
  ROLE_PACKS,
  RUBRIC_V1,
  validationNotice,
} from '@closer/core'
import { dim, heading, line } from '../terminal.ts'

function words(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

export function roles(): number {
  heading('role packs')
  for (const pack of ROLE_PACKS) {
    line(`  ${pack.id}  ${pack.label}`)
    dim(`    ${validationNotice(pack.id)}`)
    dim(`    rounds: ${pack.defaultRounds.join(', ')} · default level ${pack.defaultLevel}`)
    dim(`    vocabulary: ${pack.vocabulary.join(', ')}`)
  }
  line('')
  dim('  a role pack is data. Whether anyone has measured agreement for it is stated, not implied.')
  return 0
}

export function formats(): number {
  heading('interview formats')
  for (const format of INTERVIEW_FORMATS) {
    line(`  ${format.id}  ${format.label}`)
    for (const round of format.rounds) {
      dim(
        `    ${words(round.kind)} · ${words(round.personaId)} · ${round.turns} turns · pressure ≤ ${round.pressureCeiling}`,
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
