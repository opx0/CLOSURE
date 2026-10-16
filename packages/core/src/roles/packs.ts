import type {
  Competency,
  Level,
  RolePack,
  RoleId,
  RoundKind,
  TopicArea,
} from '@levelhead/contracts'

const SDE_GENERALIST: RolePack = {
  id: 'sde_generalist',
  label: 'Software engineer (general SDE)',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: [
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
    'behavioral',
  ],
  defaultLevel: 'junior',
  areas: ['backend', 'web'],
  vocabulary: [
    'time complexity',
    'space complexity',
    'invariant',
    'edge case',
    'race condition',
    'caching',
    'API contract',
    'unit test',
  ],
  expectedConceptsByCompetency: {
    mechanism: [
      'what the code does step by step on a concrete input',
      'which data structure holds the state and why',
    ],
    trade_offs: [
      'time against memory',
      'simplicity against performance',
      'the input size at which the choice flips',
    ],
    failure_modes: [
      'empty or boundary input',
      'concurrent access to shared state',
      'what breaks first at ten times the load',
    ],
    composure: ['says what they do not know instead of guessing'],
  },
}

const BACKEND_SERVICES: RolePack = {
  id: 'backend_services',
  label: 'Backend engineer',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: [
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
    'behavioral',
  ],
  defaultLevel: 'junior',
  areas: ['backend'],
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

const FRONTEND: RolePack = {
  id: 'frontend',
  label: 'Frontend engineer',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['cs_fundamentals', 'problem_solving', 'role_knowledge', 'behavioral'],
  defaultLevel: 'junior',
  areas: ['web'],
  vocabulary: [
    'event loop',
    'DOM',
    'reflow',
    'state management',
    'hydration',
    'accessibility',
    'bundle size',
    'same-origin policy',
  ],
  expectedConceptsByCompetency: {
    mechanism: [
      'what the browser does between a state change and pixels on screen',
      'where the state lives and who updates it',
    ],
    trade_offs: [
      'client rendering against server rendering',
      'bundle size against features',
      'the device or network at which it flips',
    ],
    failure_modes: [
      'a slow or failed request',
      'stale or inconsistent UI state',
      'what a keyboard or screen-reader user runs into',
    ],
    composure: ['separates what was measured in the browser from what was assumed'],
  },
}

const FULLSTACK: RolePack = {
  id: 'fullstack',
  label: 'Full-stack engineer',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: [
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
    'behavioral',
  ],
  defaultLevel: 'junior',
  areas: ['web', 'backend'],
  vocabulary: [
    'REST',
    'authentication',
    'session',
    'CORS',
    'caching',
    'pagination',
    'optimistic update',
    'database migration',
  ],
  expectedConceptsByCompetency: {
    mechanism: [
      'the path of one request from the click to the database and back',
      'where validation happens on each side',
    ],
    trade_offs: [
      'what the client owns against what the server owns',
      'consistency against responsiveness',
    ],
    failure_modes: [
      'a request that fails halfway',
      'client and server disagreeing about state',
      'a schema change that breaks the old client',
    ],
    composure: ['admits which layer they know less well'],
  },
}

const APPLIED_AI: RolePack = {
  id: 'applied_ai',
  label: 'ML / AI engineer',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['cs_fundamentals', 'problem_solving', 'role_knowledge', 'behavioral'],
  defaultLevel: 'junior',
  areas: ['ml', 'data'],
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
  label: 'Data engineer',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['cs_fundamentals', 'problem_solving', 'role_knowledge', 'behavioral'],
  defaultLevel: 'junior',
  areas: ['data'],
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
  label: 'DevOps / cloud / SRE',
  validation: 'unvalidated',
  competencies: ['mechanism', 'trade_offs', 'failure_modes', 'composure'],
  defaultRounds: ['cs_fundamentals', 'role_knowledge', 'system_design', 'behavioral'],
  defaultLevel: 'junior',
  areas: ['devops', 'backend'],
  vocabulary: ['error budget', 'blast radius', 'rollback', 'saturation', 'toil'],
  expectedConceptsByCompetency: {
    mechanism: ['what the control loop measures and actuates'],
    trade_offs: ['availability against change velocity'],
    failure_modes: ['what happens when the mitigation itself fails'],
    composure: ['separates the incident narrative from the root cause'],
  },
}

export const ROLE_PACKS: readonly RolePack[] = [
  SDE_GENERALIST,
  BACKEND_SERVICES,
  FRONTEND,
  FULLSTACK,
  APPLIED_AI,
  DATA_ENGINEERING,
  PLATFORM_RELIABILITY,
]

export const DEFAULT_ROLE_ID: RoleId = SDE_GENERALIST.id

export function rolePack(id: RoleId): RolePack | undefined {
  return ROLE_PACKS.find((pack) => pack.id === id)
}

export function roleCompetencies(id: RoleId): readonly Competency[] {
  return rolePack(id)?.competencies ?? SDE_GENERALIST.competencies
}

export function roleRounds(id: RoleId): readonly RoundKind[] {
  return rolePack(id)?.defaultRounds ?? SDE_GENERALIST.defaultRounds
}

export function roleLevel(id: RoleId): Level {
  return rolePack(id)?.defaultLevel ?? SDE_GENERALIST.defaultLevel
}

export function roleAreas(id: RoleId): readonly TopicArea[] {
  return rolePack(id)?.areas ?? SDE_GENERALIST.areas
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
