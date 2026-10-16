import { expect, test } from 'bun:test'
import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type {
  AnyEvent,
  Artifact,
  Claim,
  EventOf,
  GapEntry,
  InvocationRecord,
  PolicyAction,
  Topic,
  TopicArea,
} from '@levelhead/contracts'
import { AREA_ROUND, topicById } from '../topics/index.ts'
import { replay, type SessionView } from '../events/replay.ts'
import { reviewDueAt } from '../schedule/due.ts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { ConductorPort, RenderQuestionInput, RenderedQuestion } from '../ports/conductor.ts'
import type { EvaluatorPort, StructuredRequest, StructuredResult } from '../ports/evaluator.ts'
import type { EventStore } from '../ports/event-store.ts'
import type { RepositoryPort } from '../ports/repository.ts'
import { runSession, type PinnedContext, type RunSessionInput, type SessionIo } from './run.ts'

const ANSWER =
  'A deadlock needs all four conditions at once. I would break circular wait by ordering the locks, ' +
  'and I am not sure what happens after that.'

class TickingClock implements Clock {
  #tick = 0
  now(): string {
    return new Date(Date.parse('2026-09-24T09:00:00.000Z') + this.#tick++ * 1000).toISOString()
  }
}

class CountingIds implements IdSource {
  readonly #issued = new Map<string, number>()
  next(prefix: string): string {
    const next = (this.#issued.get(prefix) ?? 0) + 1
    this.#issued.set(prefix, next)
    return `${prefix}_${next}`
  }
}

class MemoryStore implements EventStore {
  readonly #events = new Map<string, AnyEvent[]>()
  async append(event: AnyEvent): Promise<void> {
    this.#events.set(event.sessionId, [...(this.#events.get(event.sessionId) ?? []), event])
  }
  async read(sessionId: string): Promise<AnyEvent[]> {
    return [...(this.#events.get(sessionId) ?? [])]
  }
  async listSessions(): Promise<string[]> {
    return [...this.#events.keys()]
  }
}

function invocation(port: InvocationRecord['port']): InvocationRecord {
  return {
    id: `inv_${port}`,
    port,
    modelAlias: 'fake',
    promptId: port,
    promptVersion: 1,
    promptHash: 'fake',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    stopReason: 'end_turn',
    latencyMs: 0,
    occurredAt: '2026-09-24T09:00:00.000Z',
  }
}

class RecordingConductor implements ConductorPort {
  readonly calls: RenderQuestionInput[] = []
  async renderQuestion(input: RenderQuestionInput): Promise<RenderedQuestion> {
    this.calls.push(input)
    return { text: `question ${this.calls.length}`, invocation: invocation('conductor') }
  }
  lastAction(): PolicyAction {
    const last = this.calls[this.calls.length - 1]
    if (last === undefined) throw new Error('judged before anything was asked')
    return last.action
  }
}

type Judge = (action: PolicyAction) => unknown

// Held to the schema the request carries, so a script cannot pass with a shape no model could return.
class ScriptedEvaluator implements EvaluatorPort {
  constructor(
    private readonly conductor: RecordingConductor,
    private readonly judge: Judge,
  ) {}
  async complete<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<Static<T>>> {
    const value = this.judge(this.conductor.lastAction())
    if (!Value.Check(request.schema, value)) {
      const errors = [...Value.Errors(request.schema, value)].map((e) => `${e.path}: ${e.message}`)
      return {
        ok: false,
        failure: { kind: 'schema_mismatch', errors, raw: JSON.stringify(value) },
        invocation: invocation('evaluator'),
      }
    }
    return { ok: true, value: value as Static<T>, invocation: invocation('evaluator') }
  }
}

interface Asked {
  text: string
  meta: Parameters<SessionIo['question']>[1]
}

function recordingIo() {
  const asked: Asked[] = []
  const notices: string[] = []
  let retriesOffered = 0
  const io: SessionIo = {
    round() {},
    question(text, meta) {
      asked.push({ text, meta })
    },
    async answer() {
      return ANSWER
    },
    findings() {},
    async confirmRetry() {
      retriesOffered += 1
      return false
    },
    notice(text) {
      notices.push(text)
    },
  }
  return { io, asked, notices, retriesOffered: () => retriesOffered }
}

const knew = (competency: 'mechanism' | 'trade_offs' | 'failure_modes') => ({
  kind: 'competency',
  competency,
  levelMet: 'junior',
  rationale: 'Named the conditions and one way to break them.',
  confidence: 0.7,
  quotes: ['break circular wait by ordering the locks'],
})

const fellShort = {
  kind: 'competency',
  competency: 'mechanism',
  levelMet: null,
  rationale: 'Named the conditions without saying how the cycle forms.',
  confidence: 0.7,
  quotes: ['needs all four conditions at once'],
}

const declined = {
  kind: 'competency_abstained',
  competency: 'mechanism',
  abstention: 'insufficient_evidence',
  rationale: 'What happens after the locks are ordered is referred to but never described.',
  confidence: 0.6,
  quotes: ['I am not sure what happens after that'],
}

const heldGround = {
  kind: 'composure',
  signals: ['holding_ground'],
  rationale: 'Kept the correct position and gave its reason.',
  confidence: 0.6,
  quotes: ['break circular wait by ordering the locks'],
}

function topic(id: string, area: TopicArea = 'os'): Topic {
  return {
    id,
    area,
    title: `Title of ${id}`,
    ask: `Ask about ${id}.`,
    minLevel: 'junior',
    expected: {
      mechanism: [`how ${id} works`],
      trade_offs: [`what ${id} costs`],
      failure_modes: [`when ${id} fails`],
    },
    falsePremise: `${id} never needs a lock.`,
    twist: `${id} now runs across two machines`,
  }
}

const CLAIM: Claim = {
  id: 'claim_1',
  spanId: 'span_resume_1',
  type: 'built',
  assertion: 'Built a lock manager that prevents deadlocks',
  technologies: ['Go'],
  metrics: [],
  implied: false,
  confirmedByCandidate: true,
  extractorVersion: 'claim-extraction@test',
}

async function run(
  over: Partial<Omit<RunSessionInput, 'deps'>> & { judge?: Judge; clock?: Clock } = {},
) {
  const {
    judge = () => ({ findings: [knew('mechanism')] }),
    clock = new TickingClock(),
    ...input
  } = over
  const store = new MemoryStore()
  const conductor = new RecordingConductor()
  const evaluator = new ScriptedEvaluator(conductor, judge)
  const recorded = recordingIo()
  const result = await runSession({
    claims: [],
    mode: 'simulation',
    level: 'junior',
    personaId: 'collaborator',
    pressureCeiling: 3,
    rounds: ['cs_fundamentals'],
    turnsPerRound: 3,
    drill: false,
    ceilings: { sessionCostUsd: 5, sessionTokens: 1_000_000, modelCallsPerTurn: 3 },
    ...input,
    deps: {
      store,
      clock,
      ids: new CountingIds(),
      conductor,
      evaluator,
      io: recorded.io,
    },
  })
  const events = await store.read(result.sessionId)
  return { result, events, conductor, ...recorded }
}

function payloads<K extends AnyEvent['kind']>(
  events: readonly AnyEvent[],
  kind: K,
): EventOf<K>['payload'][] {
  return events.flatMap((event) =>
    event.kind === kind ? [event.payload as EventOf<K>['payload']] : [],
  )
}

function serialize(view: SessionView): string {
  return JSON.stringify(view, (_key, value: unknown) =>
    value instanceof Map
      ? Object.fromEntries(value)
      : value instanceof Set
        ? [...value]
        : (value as unknown),
  )
}

test('an interview with no résumé asks about topics the session planned and recorded', async () => {
  const { result, events, asked, conductor } = await run({
    judge: () => ({
      findings: [
        {
          kind: 'claim',
          verdict: 'supported',
          rationale: 'Supports a claim nobody made.',
          confidence: 0.9,
          quotes: ['needs all four conditions at once'],
        },
        knew('mechanism'),
      ],
    }),
  })

  const session = result.view.session
  expect(session?.claimIds).toEqual([])
  expect(session?.roleId).toBe('sde_generalist')
  expect(session?.topicIds).toHaveLength(2)
  for (const id of session?.topicIds ?? []) {
    const planned = topicById(id)
    expect(planned === undefined ? undefined : AREA_ROUND[planned.area]).toBe('cs_fundamentals')
  }

  expect(asked).toHaveLength(3)
  const actions = payloads(events, 'policy_action')
  expect(actions).toHaveLength(3)
  for (const action of actions) {
    expect(session?.topicIds).toContain(action.topicId ?? 'missing')
    expect(action.claimId).toBeUndefined()
  }
  expect(asked.map((question) => question.meta.topic?.id)).toEqual(
    actions.map((action) => action.topicId),
  )
  expect(asked.map((question) => question.meta.attemptId)).toEqual(
    actions.map((action) => action.attemptId),
  )
  expect(conductor.calls.map((call) => call.topic?.id)).toEqual(
    actions.map((action) => action.topicId),
  )
  expect(conductor.calls.every((call) => call.claim === null)).toBe(true)

  expect(result.view.findings.map((finding) => finding.kind)).toEqual([
    'competency',
    'competency',
    'competency',
  ])
  expect(
    payloads(events, 'observation').filter((note) =>
      note.note.startsWith('finding dropped (claim_finding_without_claim)'),
    ),
  ).toHaveLength(3)
})

test('the session log replays to the view the session ended on', async () => {
  const { result, events } = await run({ turnsPerRound: 4 })

  const reread = replay(JSON.parse(JSON.stringify(events)) as AnyEvent[])

  expect(serialize(reread)).toBe(serialize(result.view))
  expect([...reread.attempts.values()].map((attempt) => attempt.topicId)).toEqual(
    payloads(events, 'policy_action').map((action) => action.topicId),
  )
})

const PRESSURE_MOVES: readonly string[] = [
  'TERSE_FOLLOW_UP',
  'INTERRUPT',
  'SUSTAINED_CHALLENGE',
  'CONSTRAINT_SHOCK',
  'FALSE_PREMISE',
  'APPEAL_TO_AUTHORITY',
]

test('every scenario put on a topic is the topic’s own, never one made up about a technology', async () => {
  const seeded: RenderQuestionInput[] = []
  for (const [personaId, area] of [
    ['skeptic', 'os'],
    ['bar_raiser', 'os'],
    ['bar_raiser', 'system_design'],
  ] as const) {
    const { conductor } = await run({
      topics: ['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => topic(`${area}.${slug}`, area)),
      rounds: [AREA_ROUND[area]],
      personaId,
      turnsPerRound: 20,
      judge: (action) => ({
        findings: [knew('mechanism'), ...(PRESSURE_MOVES.includes(action) ? [heldGround] : [])],
      }),
    })
    seeded.push(...conductor.calls.filter((call) => call.seed !== undefined))
  }

  const twisted = ['CHANGE_CONSTRAINT', 'CONSTRAINT_SHOCK'] as const
  for (const action of ['FALSE_PREMISE', ...twisted]) {
    expect(seeded.filter((call) => call.action === action).length).toBeGreaterThan(0)
  }
  for (const call of seeded) {
    expect(call.seed).toBe(
      call.action === 'FALSE_PREMISE'
        ? `${call.topic?.id} never needs a lock.`
        : `${call.topic?.id} now runs across two machines`,
    )
  }
})

test('a topic’s twist is put to the candidate once, whichever question reaches it first', async () => {
  const topics = [
    topic('system_design.a', 'system_design'),
    topic('system_design.b', 'system_design'),
  ]
  const short = (competency: 'mechanism' | 'trade_offs') => ({ ...fellShort, competency })

  const drilledFirst = await run({
    topics,
    rounds: ['system_design'],
    mode: 'coach',
    drill: true,
    turnsPerRound: 4,
    judge: (action) =>
      action === 'PROBE_MECHANISM'
        ? { findings: [short('mechanism')] }
        : { findings: [knew('trade_offs')] },
  })
  const changedFirst = await run({
    topics,
    rounds: ['system_design'],
    mode: 'coach',
    drill: true,
    turnsPerRound: 4,
    judge: (action) =>
      action === 'CHANGE_CONSTRAINT'
        ? { findings: [short('trade_offs')] }
        : { findings: [knew('mechanism')] },
  })

  for (const { conductor } of [drilledFirst, changedFirst]) {
    const twists = conductor.calls.filter(
      (call) => call.seed === `${call.topic?.id} now runs across two machines`,
    )
    expect(twists.map((call) => call.topic?.id)).toEqual(['system_design.a'])
  }
  expect(
    drilledFirst.conductor.calls.map((call) => [
      call.action,
      call.topic?.id,
      call.seed !== undefined,
    ]),
  ).toEqual([
    ['PROBE_MECHANISM', 'system_design.a', false],
    ['DRILL', 'system_design.a', true],
    ['PROBE_TRADE_OFF', 'system_design.a', false],
    ['TEST_FAILURE_MODE', 'system_design.a', false],
    ['PROBE_MECHANISM', 'system_design.b', false],
  ])
  expect(
    changedFirst.conductor.calls.map((call) => [
      call.action,
      call.topic?.id,
      call.seed !== undefined,
    ]),
  ).toEqual([
    ['PROBE_MECHANISM', 'system_design.a', false],
    ['CHANGE_CONSTRAINT', 'system_design.a', true],
    ['DRILL', 'system_design.a', false],
    ['TEST_FAILURE_MODE', 'system_design.a', false],
    ['PROBE_MECHANISM', 'system_design.b', false],
  ])
})

test('moving on to the next topic asks nothing, so it spends none of the round’s questions', async () => {
  const { asked, notices, result } = await run({
    topics: [topic('os.a'), topic('os.b')],
    mode: 'coach',
    turnsPerRound: 4,
  })

  expect(asked.map((question) => question.meta.topic?.id)).toEqual(['os.a', 'os.a', 'os.a', 'os.b'])
  expect(notices).toEqual(['moving on: Title of os.b'])
  expect(result.stoppedBy).toBe('turns')
})

test('declining to judge becomes its own finding, and is not a pass: the drill after it does not land', async () => {
  let judged = 0
  const { result, events, notices, conductor, retriesOffered } = await run({
    topics: [topic('os.a'), topic('os.b')],
    mode: 'coach',
    drill: true,
    turnsPerRound: 1,
    judge: () => ((judged += 1) === 1 ? { findings: [fellShort] } : { findings: [declined] }),
  })

  expect(result.view.findings.map((finding) => finding.kind)).toEqual([
    'competency',
    'competency_abstained',
  ])
  const drill = conductor.calls.find((call) => call.action === 'DRILL')
  expect(drill?.topic?.id).toBe('os.a')
  expect(drill?.seed).toBe('os.a now runs across two machines')

  const gaps = [...result.view.gaps.values()]
  expect(gaps.map((gap) => [gap.competency, gap.topicId, gap.status])).toEqual([
    ['mechanism', 'os.a', 'open'],
  ])
  expect(notices).toContain('drill did not land — the gap stays open.')
  expect(retriesOffered()).toBe(1)
  expect(payloads(events, 'state_change').some((change) => change.change === 'gap_status')).toBe(
    false,
  )
})

test('a pass on another competency is not the gap holding, in a drill or under transfer', async () => {
  const elsewhere = { findings: [declined, knew('trade_offs')] }
  let judged = 0
  const drilled = await run({
    topics: [topic('os.a'), topic('os.b')],
    mode: 'coach',
    drill: true,
    turnsPerRound: 1,
    judge: () => ((judged += 1) === 1 ? { findings: [fellShort] } : elsewhere),
  })
  expect(drilled.notices).toContain('drill did not land — the gap stays open.')

  const gap: GapEntry = {
    id: 'gap_earlier',
    competency: 'mechanism',
    topicId: 'os.a',
    summary: 'Could not say how the cycle forms.',
    status: 'drilled',
    findingIds: ['finding_earlier'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: [],
  }
  const transferred = await run({
    topics: [topic('os.a')],
    mode: 'transfer',
    transferGap: gap,
    turnsPerRound: 1,
    judge: () => elsewhere,
  })
  expect(transferred.result.view.gaps.get('gap_earlier')?.status).toBe('open')
  expect(transferred.notices).toContain(
    'the gap did not hold under changed constraints; it reopens.',
  )
})

test('a gap due for retrieval is re-asked on its own topic, and an abstention there reopens it', async () => {
  const due: GapEntry = {
    id: 'gap_earlier',
    competency: 'mechanism',
    topicId: 'os.deadlock',
    summary: 'Could not say how the cycle forms.',
    status: 'closed_under_transfer',
    findingIds: ['finding_earlier'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: ['att_earlier'],
    retrievals: [],
  }
  const elsewhere: GapEntry = { ...due, id: 'gap_elsewhere', topicId: 'dsa.hash_maps' }

  const { result, conductor } = await run({
    topics: [topic('os.a'), topic('os.b')],
    retrievals: [elsewhere, due],
    judge: () => ({ findings: [declined] }),
  })

  expect(conductor.calls.map((call) => [call.action, call.topic?.id])).toEqual([
    ['PROBE_MECHANISM', 'os.a'],
    ['PROBE_TRADE_OFF', 'os.a'],
    ['PROBE_MECHANISM', 'os.deadlock'],
  ])
  expect(result.view.gaps.get('gap_earlier')?.status).toBe('open')
  expect(result.view.gaps.get('gap_elsewhere')?.status).toBe('closed_under_transfer')
})

test('a successful retrieval survives reread and schedules its next review from the recorded outcome', async () => {
  const due: GapEntry = {
    id: 'gap_earlier',
    competency: 'mechanism',
    topicId: 'os.deadlock',
    summary: 'Could not say how the cycle forms.',
    status: 'closed_under_transfer',
    findingIds: ['finding_earlier'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: ['att_earlier'],
    retrievals: [],
  }
  const { result, asked } = await run({
    topics: [topic('os.a'), topic('os.b')],
    retrievals: [due],
    clock: { now: () => '2026-10-13T12:00:00.000Z' },
  })
  const gap = result.view.gaps.get(due.id)
  const retrieved = asked[2]
  if (retrieved === undefined) throw new Error('the retrieval question was not asked')
  expect(gap?.retrievals).toEqual([
    { attemptId: retrieved.meta.attemptId, at: '2026-10-13T12:00:00.000Z', passed: true },
  ])
  expect(gap?.transferAttemptIds).toEqual(['att_earlier'])
  expect(gap?.lastTouchedAt).toBe('2026-10-13T12:00:00.000Z')
  expect(gap === undefined ? undefined : reviewDueAt(gap)).toBe('2026-10-16T12:00:00.000Z')
})

test('a repeated failed Transfer does not undo a later Drill through the general finding path', async () => {
  const carried: GapEntry = {
    id: 'gap-carried',
    competency: 'mechanism',
    topicId: 'os.a',
    summary: 'Explain the cycle.',
    status: 'drilled',
    findingIds: ['finding-prior'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: ['att_2'],
    practiceReceipts: [
      { attemptId: 'att_2', kind: 'transfer', held: false },
      { attemptId: 'later-drill', kind: 'drill', held: true },
    ],
  }
  const { result } = await run({
    topics: [topic('os.a')],
    mode: 'transfer',
    transferGap: carried,
    turnsPerRound: 1,
    judge: () => ({ findings: [fellShort] }),
  })
  expect(result.view.gaps.get(carried.id)).toEqual(carried)
})

test('a conflicting Transfer returns a named rejection without mutating the original gap', async () => {
  const carried: GapEntry = {
    id: 'gap-carried',
    competency: 'mechanism',
    topicId: 'os.a',
    summary: 'Explain the cycle.',
    status: 'drilled',
    findingIds: ['finding-prior'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: ['att_2'],
    practiceReceipts: [{ attemptId: 'att_2', kind: 'transfer', held: true }],
  }
  const { result, events } = await run({
    topics: [topic('os.a')],
    mode: 'transfer',
    transferGap: carried,
    turnsPerRound: 1,
    judge: () => ({ findings: [fellShort] }),
  })
  expect(result.stoppedBy).toBe('practice_outcome_rejected')
  if (result.stoppedBy === 'practice_outcome_rejected')
    expect(result.failure.kind).toBe('attempt_conflict')
  expect(result.view.gaps.get(carried.id)).toEqual(carried)
  expect(result.view.state).toBe('closed')
  expect(
    payloads(events, 'state_change').filter(
      (change) => change.change === 'gap_status' || change.change === 'practice_outcome',
    ),
  ).toEqual([])
})

test('a walkthrough with a pinned repository and no résumé opens ranked code and shows it', async () => {
  const parse = 'function parse(input: string) {\n  return input.split(",")\n}'
  const code: Record<string, string> = {
    art_parse: parse,
    art_schedule: 'function schedule(jobs: Job[]) {\n  return jobs.sort(byDeadline)\n}',
  }
  const artifact = (id: string, path: string, symbol: string, startLine: number): Artifact => ({
    id,
    snapshotId: 'snap_1',
    kind: 'function',
    path,
    symbol,
    startLine,
    endLine: startLine + 20,
  })
  const read: string[] = []
  const repository: RepositoryPort = {
    async pin() {
      throw new Error('a session never pins')
    },
    async read(opened) {
      read.push(opened.id)
      return code[opened.id] ?? null
    },
  }
  const pinned: PinnedContext = {
    snapshot: {
      id: 'snap_1',
      repoPath: '/work/project',
      commit: 'abc123',
      pinnedAt: '2026-09-24T08:00:00.000Z',
      fileCount: 3,
    },
    artifacts: [
      artifact('art_test', 'src/parse.test.ts', 'parsesCommas', 1),
      artifact('art_schedule', 'src/schedule.ts', 'schedule', 30),
      artifact('art_parse', 'src/parse.ts', 'parse', 10),
    ],
    evidence: [],
    repository,
  }

  const { result, events, asked, conductor } = await run({
    rounds: ['code_walkthrough'],
    pinned,
    turnsPerRound: 5,
  })

  expect(read).toEqual(['art_parse', 'art_schedule'])
  expect(asked[0]?.meta.artifact).toEqual({
    artifactId: 'art_parse',
    path: 'src/parse.ts',
    symbol: 'parse',
    startLine: 10,
    endLine: 30,
    code: parse,
  })
  expect(asked[0]?.meta.topic).toBeUndefined()
  expect(conductor.calls[0]?.artifact?.code).toBe(parse)
  expect(conductor.calls.every((call) => call.claim === null)).toBe(true)
  const opened = new Set(payloads(events, 'policy_action').map((action) => action.artifactId))
  expect(opened).toEqual(new Set(['art_parse', 'art_schedule']))
  expect(payloads(events, 'policy_action').every((action) => action.claimId === undefined)).toBe(
    true,
  )
  expect(result.view.session?.topicIds).toBeUndefined()
})

test('a round with nothing to ask about is skipped out loud, not asked generically', async () => {
  const { result, events, asked, notices } = await run({
    rounds: ['project_deep_dive', 'code_walkthrough'],
  })

  expect(asked).toEqual([])
  expect(notices).toEqual([
    'project_deep_dive skipped: it cross-questions confirmed résumé claims, and none are confirmed.',
    'code_walkthrough skipped: it opens code from a pinned repository, and there is none to open.',
  ])
  expect(payloads(events, 'state_change').some((change) => change.change === 'round_started')).toBe(
    false,
  )
  expect(result.view.session?.roleId).toBeUndefined()
})

test('a résumé cross-examination still interrogates the claim and cites it', async () => {
  const { result, events, conductor } = await run({
    claims: [CLAIM],
    rounds: ['project_deep_dive'],
    turnsPerRound: 2,
    judge: () => ({
      findings: [
        {
          kind: 'claim',
          verdict: 'partially_supported',
          rationale: 'Ordering is described; recovery is not.',
          confidence: 0.7,
          quotes: ['break circular wait by ordering the locks'],
        },
      ],
    }),
  })

  expect(result.view.session?.claimIds).toEqual(['claim_1'])
  expect(result.view.session?.topicIds).toBeUndefined()
  expect(conductor.calls.map((call) => [call.action, call.claim?.id, call.topic])).toEqual([
    ['PROBE_MECHANISM', 'claim_1', undefined],
    ['TEST_FAILURE_MODE', 'claim_1', undefined],
  ])
  expect(payloads(events, 'policy_action').map((action) => action.claimId)).toEqual([
    'claim_1',
    'claim_1',
  ])
  expect(result.view.findings.map((finding) => finding.kind)).toEqual(['claim', 'claim'])
  expect(payloads(events, 'plan').every((plan) => plan.nextClaimId === undefined)).toBe(true)
})

test('a design extension picks up on the claim the deep dive ended on', async () => {
  const second: Claim = {
    ...CLAIM,
    id: 'claim_2',
    spanId: 'span_resume_2',
    assertion: 'Built a job queue with leases',
  }
  const { events, conductor } = await run({
    claims: [CLAIM, second],
    rounds: ['project_deep_dive', 'design_extension'],
    turnsPerRound: 5,
  })

  expect(conductor.calls.map((call) => [call.round, call.claim?.id])).toEqual([
    ['project_deep_dive', 'claim_1'],
    ['project_deep_dive', 'claim_1'],
    ['project_deep_dive', 'claim_1'],
    ['project_deep_dive', 'claim_2'],
    ['project_deep_dive', 'claim_2'],
    ['design_extension', 'claim_2'],
    ['design_extension', 'claim_2'],
    ['design_extension', 'claim_2'],
    ['design_extension', 'claim_1'],
    ['design_extension', 'claim_1'],
  ])
  const plans = payloads(events, 'plan')
  expect(plans.flatMap((plan) => plan.nextSubjectId ?? [])).toEqual(['claim_2', 'claim_1'])
  expect(plans.every((plan) => plan.nextClaimId === undefined)).toBe(true)
})
