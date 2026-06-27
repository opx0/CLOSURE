import type { Competency, Level, RolePack, RoleId, RoundKind } from '@closer/contracts'

const BACKEND_SERVICES: RolePack = {
  id: 'backend_services',
  label: 'Backend / distributed services',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['project_deep_dive', 'design_extension', 'code_walkthrough'],
  defaultLevel: 'mid',
  vocabulary: [
    'idempotency',
    'lease',
    'at-least-once delivery',
    'backpressure',
    'partial failure',
    'replication lag',
    'transaction boundary',
    'schema migration',
  ],
  expectedConceptsByCompetency: {
    mechanism: ['who writes the state', 'when the state is durable', 'what happens on retry'],
    trade_offs: ['what consistency was traded for what latency', 'the load at which it flips'],
    failure_modes: ['duplicate work', 'lost work', 'stuck work', 'what pages'],
    composure: ['admits an unhandled case rather than inventing one'],
  },
}

const APPLIED_AI: RolePack = {
  id: 'applied_ai',
  label: 'Applied AI / LLM systems',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['project_deep_dive', 'design_extension', 'behavioral'],
  defaultLevel: 'mid',
  vocabulary: [
    'retrieval',
    'grounding',
    'evaluation set',
    'hallucination',
    'prompt injection',
    'structured output',
    'token budget',
    'calibration',
  ],
  expectedConceptsByCompetency: {
    mechanism: ['what the model actually sees', 'what is deterministic around it'],
    trade_offs: ['quality against cost or latency', 'why this model class'],
    failure_modes: ['what a wrong output costs', 'how a wrong output is detected'],
    composure: ['separates what was measured from what was assumed'],
  },
}

const DATA_ENGINEERING: RolePack = {
  id: 'data_engineering',
  label: 'Data engineering / batch pipelines',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['project_deep_dive', 'design_extension'],
  defaultLevel: 'mid',
  vocabulary: ['idempotent reprocessing', 'watermark', 'late data', 'backfill', 'schema evolution'],
  expectedConceptsByCompetency: {
    mechanism: ['what a rerun does to already-written rows'],
    trade_offs: ['freshness against cost'],
    failure_modes: ['partial batch', 'duplicated rows', 'silently dropped records'],
    composure: ['admits which numbers were never verified'],
  },
}

const PLATFORM_RELIABILITY: RolePack = {
  id: 'platform_reliability',
  label: 'Platform / reliability engineering',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['project_deep_dive', 'design_extension', 'behavioral'],
  defaultLevel: 'senior',
  vocabulary: ['error budget', 'blast radius', 'rollback', 'saturation', 'toil'],
  expectedConceptsByCompetency: {
    mechanism: ['what the control loop measures and actuates'],
    trade_offs: ['availability against change velocity'],
    failure_modes: ['what happens when the mitigation itself fails'],
    composure: ['separates the incident narrative from the root cause'],
  },
}

export const ROLE_PACKS: readonly RolePack[] = [
  BACKEND_SERVICES,
  APPLIED_AI,
  DATA_ENGINEERING,
  PLATFORM_RELIABILITY,
]

export const DEFAULT_ROLE_ID: RoleId = BACKEND_SERVICES.id

export function rolePack(id: RoleId): RolePack | undefined {
  return ROLE_PACKS.find((pack) => pack.id === id)
}

export function roleCompetencies(id: RoleId): readonly Competency[] {
  return rolePack(id)?.competencies ?? BACKEND_SERVICES.competencies
}

export function roleRounds(id: RoleId): readonly RoundKind[] {
  return rolePack(id)?.defaultRounds ?? BACKEND_SERVICES.defaultRounds
}

export function roleLevel(id: RoleId): Level {
  return rolePack(id)?.defaultLevel ?? BACKEND_SERVICES.defaultLevel
}

export function expectedConceptsFor(id: RoleId, competency: Competency): readonly string[] {
  return rolePack(id)?.expectedConceptsByCompetency[competency] ?? []
}

export function validationNotice(id: RoleId): string {
  const pack = rolePack(id)
  if (pack === undefined) return `no role pack named ${id}`
  return pack.validation === 'measured'
    ? `${pack.label}: agreement measured against human labels.`
    : `${pack.label}: no agreement has been measured for this role. Findings here are unvalidated.`
}
