import { createHash } from 'node:crypto'
import { PERSONA_VOICE } from '@levelhead/prompts'
import {
  ACTIONS,
  ACTION_ORDER,
  AREA_ROUND,
  CeilingBreach,
  CeilingLedger,
  DEFAULT_ROLE_ID,
  INITIAL_PRESSURE,
  PERSONAS,
  ROUND_ARCS,
  SessionLog,
  applyPracticeOutcome,
  evaluateAnswer,
  gapHeld,
  gapsFromFindings,
  indexGaps,
  nextPressure,
  planTopics,
  rankArtifacts,
  replay,
  rubricSetV1,
  selectAction,
  topicById,
  transition,
} from '../index.ts'
import type {
  ArtifactContext,
  Ceilings,
  Clock,
  ConductorPort,
  EvaluatorPort,
  EventStore,
  IdSource,
  PressureLevel,
  PressureState,
  RepositoryPort,
  SessionTrigger,
  SessionView,
  SubjectKind,
  PracticeOutcomeFailure,
  PracticeOutcomeResult,
} from '../index.ts'
import type {
  Artifact,
  Claim,
  Competency,
  EventOf,
  Evidence,
  Finding,
  GapEntry,
  InvocationRecord,
  Level,
  Mode,
  PersonaId,
  PolicyAction,
  PracticeOutcome,
  RoleId,
  RoundKind,
  Session,
  SessionState,
  Snapshot,
  Topic,
} from '@levelhead/contracts'

// What one thread of questions is about. An artifact carries the confirmed claim it bears on, if any.
export type Subject =
  | { kind: 'claim'; id: string; claim: Claim }
  | { kind: 'topic'; id: string; topic: Topic }
  | { kind: 'artifact'; id: string; artifact: ArtifactContext; claim: Claim | null }

export interface SessionIo {
  round(kind: RoundKind, index: number, total: number, brief?: string): void
  question(
    text: string,
    meta: {
      attemptId: string
      turn: number
      action: PolicyAction
      pressureLevel: number
      round: RoundKind
      hint?: (level: number) => Promise<string>
      topic?: Pick<Topic, 'id' | 'area' | 'title'>
      // The résumé line under question, or the one the opened code is linked to.
      claim?: Pick<Claim, 'id' | 'assertion'>
      // The exact code the question is about, so it can be shown beside the question.
      artifact?: ArtifactContext
    },
  ): void
  answer(): Promise<string>
  findings(findings: readonly Finding[], quotes: ReadonlyMap<string, string>): void
  // Only called in coach mode; simulation withholds feedback until the section ends (§4.9).
  confirmRetry(): Promise<boolean>
  notice(text: string): void
}

export interface SessionDeps {
  store: EventStore
  clock: Clock
  ids: IdSource
  conductor: ConductorPort
  evaluator: EvaluatorPort
  io: SessionIo
}

export interface PinnedContext {
  snapshot: Snapshot
  artifacts: Artifact[]
  evidence: Evidence[]
  repository: RepositoryPort
}

export interface RunSessionInput {
  claims: readonly Claim[]
  // Replaces planning: each topic round asks exactly the given topics whose area belongs to it.
  topics?: readonly Topic[]
  // Topic ids asked in earlier sessions, so planning reaches for ones not asked yet.
  topicHistory?: readonly string[]
  mode: Mode
  level: Level
  personaId: PersonaId
  role?: RoleId
  pressureCeiling: PressureLevel
  rounds: readonly RoundKind[]
  turnsPerRound: number
  drill: boolean
  transferGap?: GapEntry
  drillGap?: GapEntry
  // Gaps due for spaced retrieval; asked as ordinary questions, never announced as reviews (§4.5).
  retrievals?: readonly GapEntry[]
  pinned?: PinnedContext
  ceilings: Ceilings
  deps: SessionDeps
}

type SessionStopReason = 'turns' | 'end_topic' | 'ceiling' | 'evaluator_failure'
export type SessionResult = { sessionId: string; view: SessionView } & (
  | { stoppedBy: SessionStopReason }
  | { stoppedBy: 'practice_outcome_rejected'; failure: PracticeOutcomeFailure }
)

function claimOf(subject: Subject): Claim | null {
  return subject.kind === 'topic' ? null : subject.claim
}

function topicSubject(topic: Topic): Subject {
  return { kind: 'topic', id: topic.id, topic }
}

function describe(subject: Subject): string {
  switch (subject.kind) {
    case 'claim':
      return subject.claim.assertion
    case 'topic':
      return subject.topic.title
    case 'artifact':
      return subject.artifact.symbol === undefined
        ? subject.artifact.path
        : `${subject.artifact.path} · ${subject.artifact.symbol}`
  }
}

// Enough that END_TOPIC always has somewhere to go.
function subjectsPerRound(turnsPerRound: number): number {
  return Math.max(2, Math.ceil(turnsPerRound / 2))
}

// Refused rather than degraded: a round without its subject is a generic question wearing its name.
const EMPTY_ROUND: Record<SubjectKind, string> = {
  topic: 'no topic in the catalog fits this role and level',
  claim: 'it cross-questions confirmed résumé claims, and none are confirmed',
  artifact: 'it opens code from a pinned repository, and there is none to open',
}

// Seed content is chosen by code, not the model — e.g. FALSE_PREMISE's wrong statement can't drift (ticket 05 §3).
function seedFor(action: PolicyAction, subject: Subject): string | undefined {
  if (!ACTIONS[action].needsSeed) return undefined
  if (subject.kind === 'topic') {
    switch (action) {
      case 'FALSE_PREMISE':
        return subject.topic.falsePremise
      case 'CHANGE_CONSTRAINT':
      case 'CONSTRAINT_SHOCK':
      case 'DRILL':
      case 'TRANSFER_TEST':
        return subject.topic.twist
    }
  }
  // Named, never quoted: a seed is not fenced, and a technology comes from the résumé, which is.
  const technology =
    claimOf(subject) === null ? 'the system' : 'the main technology the claim names'
  switch (action) {
    case 'FALSE_PREMISE':
      return `${technology} already guarantees this on its own, so the application never has to handle the duplicate case.`
    case 'CONSTRAINT_SHOCK':
      return `the volume is now 100× what you described, and the deadline is unchanged`
    case 'APPEAL_TO_AUTHORITY':
      return `a staff engineer who reviewed this said the approach is wrong`
    case 'CHANGE_CONSTRAINT':
      return `the same requirement, but ${technology} is no longer available to you`
    case 'DRILL':
    case 'TRANSFER_TEST':
      return `the same idea in a system built without ${technology}`
    default:
      return undefined
  }
}

// Chosen by the selector, so a scenario already put to a subject can be ruled out before it is picked.
// DRILL and TRANSFER_TEST are what their modes are for and repeat by design.
const SELECTED_SEEDED: readonly PolicyAction[] = ACTION_ORDER.filter(
  (action) => ACTIONS[action].needsSeed && action !== 'DRILL' && action !== 'TRANSFER_TEST',
)

// Only decides whether to offer a retry; whether a gap held is `gapHeld`, judged on the gap's own terms.
function answeredWell(findings: readonly Finding[]): boolean {
  return findings.some(
    (finding) =>
      (finding.kind === 'claim' && finding.verdict === 'supported') ||
      (finding.kind === 'competency' && finding.levelMet !== null),
  )
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function planRoundTopics(input: RunSessionInput, seed: string, roleId: RoleId): Topic[][] {
  const planned: string[] = []
  return input.rounds.map((round) => {
    if (ROUND_ARCS[round].subject !== 'topic') return []
    const topics =
      input.topics === undefined
        ? planTopics({
            roleId,
            round,
            level: input.level,
            count: subjectsPerRound(input.turnsPerRound),
            seed,
            askedBefore: input.topicHistory ?? [],
            exclude: planned,
          })
        : input.topics.filter(
            (topic) => AREA_ROUND[topic.area] === round && !planned.includes(topic.id),
          )
    planned.push(...topics.map((topic) => topic.id))
    return topics
  })
}

export async function runSession(input: RunSessionInput): Promise<SessionResult> {
  const { deps } = input
  const sessionId = deps.ids.next('ses')
  const log = await SessionLog.open(deps, sessionId)
  const ceilings = new CeilingLedger(input.ceilings)

  const ceiling = Math.min(
    input.pressureCeiling,
    PERSONAS[input.personaId].pressureCeiling,
  ) as PressureLevel
  let pressure: PressureState = INITIAL_PRESSURE
  // Object, not a `let`: `goto` mutates it from a closure, where a plain local would stay narrowed to its initial value.
  const machine: { state: SessionState } = { state: 'selecting' }

  const goto = async (trigger: SessionTrigger): Promise<void> => {
    const to = transition(machine.state, trigger)
    await log.append('state_change', { change: 'session_state', from: machine.state, to })
    machine.state = to
  }

  // Caller filters too; this guard still holds if that one stops (§4.1).
  const inPlay = input.claims.filter((claim) => claim.confirmedByCandidate)

  // Planned before the session starts and recorded in it, so replay never re-runs selection.
  const asksTopics = input.rounds.some((round) => ROUND_ARCS[round].subject === 'topic')
  const roleId = input.role ?? (asksTopics ? DEFAULT_ROLE_ID : undefined)
  const plannedTopics = planRoundTopics(input, sessionId, roleId ?? DEFAULT_ROLE_ID)

  const session: Session = {
    id: sessionId,
    mode: input.mode,
    level: input.level,
    personaId: input.personaId,
    pressureLevel: pressure.level,
    pressureCeiling: ceiling,
    rubricSet: rubricSetV1,
    claimIds: inPlay.map((claim) => claim.id),
    ...(roleId === undefined ? {} : { roleId }),
    ...(asksTopics ? { topicIds: plannedTopics.flat().map((topic) => topic.id) } : {}),
    rounds: [...input.rounds],
    ...(input.pinned === undefined ? {} : { snapshotId: input.pinned.snapshot.id }),
    ...((input.drillGap ?? input.transferGap) === undefined
      ? {}
      : { practiceGapId: (input.drillGap ?? input.transferGap)!.id }),
    startedAt: deps.clock.now(),
  }
  await log.append('state_change', { change: 'session_started', session })

  if (input.pinned !== undefined) {
    await log.append('state_change', {
      change: 'snapshot_pinned',
      snapshot: input.pinned.snapshot,
      artifacts: input.pinned.artifacts,
      evidence: input.pinned.evidence,
    })
  }
  const pendingRetrievals = [...(input.retrievals ?? [])]
  const gaps = new Map<string, GapEntry>()
  for (const gap of pendingRetrievals) {
    await log.append('state_change', { change: 'gap_opened', gap })
    gaps.set(gap.id, gap)
  }
  const carriedGap = input.drillGap ?? input.transferGap
  if (carriedGap !== undefined) {
    // Re-opened as a fresh event so this session's log replays standalone; the ledger merges by id.
    await log.append('state_change', { change: 'gap_opened', gap: carriedGap })
    gaps.set(carriedGap.id, carriedGap)
  }

  const transcript: { role: 'interviewer' | 'candidate'; text: string }[] = []
  const recentActions: PolicyAction[] = []
  const quotes = new Map<string, string>()
  // Same reason as `machine` above: assigned from closures.
  const outcome: { stoppedBy: SessionStopReason } = { stoppedBy: 'turns' }
  let rejection: PracticeOutcomeFailure | undefined
  let drilled = false
  // Every scenario already put to each subject: a topic's one twist serves four actions.
  const scenarios = new Map<string, Set<string>>()
  const putBefore = (subject: Subject, seed: string | undefined): boolean =>
    seed !== undefined && (scenarios.get(subject.id)?.has(seed) ?? false)

  const RETRIEVAL_ACTION: Record<Competency, PolicyAction> = {
    mechanism: 'PROBE_MECHANISM',
    failure_modes: 'TEST_FAILURE_MODE',
    trade_offs: 'PROBE_TRADE_OFF',
    composure: 'SUSTAINED_CHALLENGE',
  }

  const topicFor = (id: string): Topic | undefined =>
    input.topics?.find((topic) => topic.id === id) ?? topicById(id)

  const openArtifacts = async (): Promise<Subject[]> => {
    if (input.pinned === undefined) return []
    const ranked = rankArtifacts({
      artifacts: input.pinned.artifacts,
      evidence: input.pinned.evidence,
      claims: inPlay,
    }).slice(0, subjectsPerRound(input.turnsPerRound))
    const opened: Subject[] = []
    for (const { artifact, claim } of ranked) {
      const code = await input.pinned.repository.read(artifact)
      // A snapshot is deletable; code that is gone is not asked about without its citation.
      if (code === null) continue
      opened.push({
        kind: 'artifact',
        id: artifact.id,
        artifact: {
          artifactId: artifact.id,
          path: artifact.path,
          ...(artifact.symbol === undefined ? {} : { symbol: artifact.symbol }),
          ...(artifact.startLine === undefined ? {} : { startLine: artifact.startLine }),
          ...(artifact.endLine === undefined ? {} : { endLine: artifact.endLine }),
          code,
        },
        claim,
      })
    }
    return opened
  }

  const subjectsFor = async (round: RoundKind, roundIndex: number): Promise<Subject[]> => {
    switch (ROUND_ARCS[round].subject) {
      case 'topic':
        return (plannedTopics[roundIndex] ?? []).map(topicSubject)
      case 'claim':
        return inPlay.map((claim) => ({ kind: 'claim', id: claim.id, claim }))
      case 'artifact':
        return openArtifacts()
    }
  }

  // A gap waits for a round about its own subject: a DBMS question dropped into a résumé deep dive
  // is a non sequitur, and one that announces a review.
  const retrievalSubject = (gap: GapEntry, round: RoundKind, current: Subject): Subject | null => {
    const kind = ROUND_ARCS[round].subject
    if (gap.topicId !== undefined) {
      const topic = topicFor(gap.topicId)
      return kind === 'topic' && topic !== undefined && AREA_ROUND[topic.area] === round
        ? topicSubject(topic)
        : null
    }
    if (gap.claimId === undefined) return current
    if (kind !== 'claim') return null
    const claim = inPlay.find((candidate) => candidate.id === gap.claimId)
    return claim === undefined ? current : { kind: 'claim', id: claim.id, claim }
  }

  const takeRetrieval = (
    round: RoundKind,
    current: Subject,
  ): { gap: GapEntry; subject: Subject } | undefined => {
    for (const [at, gap] of pendingRetrievals.entries()) {
      const subject = retrievalSubject(gap, round, current)
      if (subject === null) continue
      pendingRetrievals.splice(at, 1)
      return { gap, subject }
    }
    return undefined
  }

  const gapSubject = (gap: GapEntry, current: Subject): Subject => {
    const topic = gap.topicId === undefined ? undefined : topicFor(gap.topicId)
    return topic === undefined ? current : topicSubject(topic)
  }

  interface TurnResult {
    attemptId: string
    findings: Finding[]
    pressureApplied: boolean
  }

  const runTurn = async (
    action: PolicyAction,
    round: RoundKind,
    subject: Subject,
    turn: number,
    reuseQuestion?: string,
  ): Promise<TurnResult | null> => {
    // One attempt is one turn for budgeting: a drill/retry is charged its own turn, not the one that surfaced it.
    ceilings.beginTurn()
    const attemptId = deps.ids.next('att')
    const claim = claimOf(subject)
    const topic = subject.kind === 'topic' ? subject.topic : undefined
    const artifact = subject.kind === 'artifact' ? subject.artifact : undefined
    await log.append('policy_action', {
      attemptId,
      action,
      round,
      pressureLevel: pressure.level,
      ...(claim === null ? {} : { claimId: claim.id }),
      ...(topic === undefined ? {} : { topicId: topic.id }),
      ...(artifact === undefined ? {} : { artifactId: artifact.artifactId }),
    })
    if (machine.state === 'selecting') await goto('action_selected')

    let text = reuseQuestion
    if (text === undefined) {
      const scenario = seedFor(action, subject)
      // A drill isolates the skill; without a fresh scenario it does that on the question alone.
      const seed = action === 'DRILL' && putBefore(subject, scenario) ? undefined : scenario
      if (seed !== undefined)
        scenarios.set(subject.id, new Set(scenarios.get(subject.id)).add(seed))
      ceilings.assertCanCall()
      const rendered = await deps.conductor.renderQuestion({
        action,
        round,
        pressureLevel: pressure.level,
        level: input.level,
        personaId: input.personaId,
        claim,
        ...(topic === undefined
          ? {}
          : { topic: { id: topic.id, area: topic.area, title: topic.title, ask: topic.ask } }),
        transcript,
        ...(seed === undefined ? {} : { seed }),
        ...(artifact === undefined ? {} : { artifact }),
      })
      ceilings.record(rendered.invocation)
      text = rendered.text
      await log.append('question', { attemptId, text, invocation: rendered.invocation })
    } else {
      // Re-asks the already-rendered question; re-rendering would change what the candidate is retrying.
      await log.append('question', {
        attemptId,
        text,
        invocation: { ...(await lastQuestionInvocation()), id: deps.ids.next('inv') },
      })
    }
    if (machine.state === 'asking') await goto('question_rendered')

    let answered = false
    const hint =
      input.mode !== 'drill' ||
      input.drillGap === undefined ||
      topic === undefined ||
      input.drillGap.competency === 'composure'
        ? undefined
        : async (level: number) => {
            if (answered || !Number.isInteger(level) || level < 1 || level > 3)
              throw new Error('Hint is unavailable for this attempt')
            const concepts =
              topic.expected[
                input.drillGap!.competency as 'mechanism' | 'trade_offs' | 'failure_modes'
              ]
            const text =
              level === 1
                ? `Consider this scenario: ${topic.twist}. Explain the ${input.drillGap!.competency.replace(/_/g, ' ')}.`
                : level === 2
                  ? concepts[0]!
                  : concepts.join('; ')
            await log.append('state_change', {
              change: 'practice_assistance',
              attemptId,
              level,
              hintId: `${topic.id}.${input.drillGap!.competency}.v1.${level}`,
              text,
            })
            return text
          }
    deps.io.question(text, {
      attemptId,
      turn,
      action,
      ...(hint === undefined ? {} : { hint }),
      pressureLevel: pressure.level,
      round,
      ...(topic === undefined
        ? {}
        : { topic: { id: topic.id, area: topic.area, title: topic.title } }),
      ...(claim === null ? {} : { claim: { id: claim.id, assertion: claim.assertion } }),
      ...(artifact === undefined ? {} : { artifact }),
    })
    transcript.push({ role: 'interviewer', text })

    const answerText = await deps.io.answer()
    answered = true
    const sourceId = `answer:${attemptId}`
    await log.append('state_change', {
      change: 'source_registered',
      sourceId,
      kind: 'answer',
      text: answerText,
      contentHash: digest(answerText),
    })
    await log.append('answer', { attemptId, sourceId, text: answerText })
    transcript.push({ role: 'candidate', text: answerText })
    await goto('answer_received')

    ceilings.assertCanCall()
    const evaluated = await evaluateAnswer({
      attemptId,
      claim,
      ...(claim === null ? {} : { claimSpanId: claim.spanId }),
      action,
      round,
      level: input.level,
      answerText,
      answerSourceId: sourceId,
      transcript,
      rubricSet: rubricSetV1,
      ...(input.role === undefined ? {} : { role: input.role }),
      evaluator: deps.evaluator,
      ids: deps.ids,
      clock: deps.clock,
      ...(artifact === undefined ? {} : { artifact }),
      ...(topic === undefined ? {} : { topic }),
    })
    ceilings.record(evaluated.invocation)

    if ('failed' in evaluated) {
      // Stop rather than continue judging nothing — that would leave a session that looks complete but isn't.
      deps.io.notice(`evaluator failed: ${evaluated.failed.kind} — the session stops here.`)
      outcome.stoppedBy = 'evaluator_failure'
      return null
    }

    for (const dropped of evaluated.dropped) {
      await log.append('observation', {
        attemptId,
        note: `finding dropped (${dropped.reason}): ${dropped.rationale}`,
        spanIds: [],
      })
    }

    const pressureApplied = ACTIONS[action].isPressure

    // `evaluating` is a state a turn only reaches when there is something to judge with.
    if (evaluated.findings.length === 0) {
      deps.io.notice('nothing survived citation checking this turn — no finding is recorded.')
      await goto('evaluation_deferred')
      return { attemptId, findings: [], pressureApplied }
    }

    await goto('observations_recorded')
    await log.append('evaluation', {
      attemptId,
      // Widening non-empty tuples to the schema's plain `minItems: 1` arrays loses nothing.
      findings: evaluated.findings as unknown as EventOf<'evaluation'>['payload']['findings'],
      spans: evaluated.spans,
      evidence: evaluated.evidence,
      invocation: evaluated.invocation,
    })

    const spanText = new Map(evaluated.spans.map((span) => [span.id, span.quoted]))
    for (const link of evaluated.evidence) {
      if (link.target.kind === 'span') {
        const found = spanText.get(link.target.spanId)
        if (found !== undefined) quotes.set(link.id, found)
      }
    }
    return { attemptId, findings: [...evaluated.findings], pressureApplied }
  }

  async function lastQuestionInvocation() {
    const events = log.events()
    for (let at = events.length - 1; at >= 0; at -= 1) {
      const event = events[at]
      if (event?.kind === 'question') return event.payload.invocation
    }
    throw new Error('a retry needs a question to retry')
  }

  const recordOutcome = async (
    findings: readonly Finding[],
    pressureApplied: boolean,
    subject: Subject,
  ) => {
    const signals = findings.flatMap((finding) =>
      finding.kind === 'composure' ? finding.signals : [],
    )
    const stepped = nextPressure(pressure, signals, {
      mode: input.mode,
      ceiling,
      pressureApplied,
    })
    if (stepped.state.level !== pressure.level) {
      await log.append('state_change', {
        change: 'pressure_level',
        from: pressure.level,
        to: stepped.state.level,
        reason: stepped.reason,
      })
    }
    pressure = stepped.state

    const { opened, transitions } = gapsFromFindings(
      findings,
      indexGaps([...gaps.values()]),
      { ids: deps.ids, clock: deps.clock },
      subject.kind === 'topic' ? { topicId: subject.id } : {},
    )
    for (const gap of opened) {
      await log.append('state_change', { change: 'gap_opened', gap })
      gaps.set(gap.id, gap)
    }
    for (const change of transitions) {
      const event = await log.append('state_change', {
        change: 'gap_status',
        gapId: change.gapId,
        from: change.from,
        to: change.to,
      })
      const existing = gaps.get(change.gapId)
      if (existing) {
        gaps.set(change.gapId, { ...existing, status: change.to, lastTouchedAt: event.occurredAt })
      }
    }
  }

  const recordPracticeOutcome = async (
    gapId: string,
    attemptId: string,
    kind: PracticeOutcome['kind'],
    findings: readonly Finding[],
  ): Promise<PracticeOutcomeResult> => {
    const gap = gaps.get(gapId)
    if (gap === undefined) throw new Error(`cannot practise missing gap ${gapId}`)
    const outcome: PracticeOutcome = { gapId, attemptId, kind, held: gapHeld(gap, findings) }
    const preview = applyPracticeOutcome({
      gap,
      outcome: { ...outcome, occurredAt: gap.lastTouchedAt },
    })
    if (preview.kind !== 'applied') return preview
    const event = await log.append('state_change', { change: 'practice_outcome', ...outcome })
    const applied = applyPracticeOutcome({
      gap,
      outcome: { ...outcome, occurredAt: event.occurredAt },
    })
    if (applied.kind === 'applied') gaps.set(gapId, applied.gap)
    return applied
  }

  try {
    const transferTopic =
      input.transferGap?.topicId === undefined ? undefined : topicFor(input.transferGap.topicId)
    let carried: string | undefined

    for (const [roundIndex, round] of input.rounds.entries()) {
      const subjects = await subjectsFor(round, roundIndex)
      const [first] = subjects
      if (first === undefined) {
        deps.io.notice(`${round} skipped: ${EMPTY_ROUND[ROUND_ARCS[round].subject]}.`)
        continue
      }
      // A chained round over the same claims picks up the thread where the last round left it.
      let current: Subject = subjects.find((subject) => subject.id === carried) ?? first
      // Reset per round, not per session — coverage in one round doesn't count in the next (§4.7).
      const coveredBySubject = new Map<string, Competency[]>()
      const askedCounts: Record<string, number> = {}
      let handoffs = 0
      let brief: string | undefined
      let briefInvocation: InvocationRecord | undefined
      if (deps.conductor.renderRoundBrief !== undefined) {
        ceilings.beginTurn()
        ceilings.assertCanCall()
        const spoken = await deps.conductor.renderRoundBrief({
          round,
          roundIndex,
          totalRounds: input.rounds.length,
          personaId: input.personaId,
          claim: claimOf(current),
        })
        ceilings.record(spoken.invocation)
        briefInvocation = spoken.invocation
        // A weak model asked to speak "in" a described voice sometimes just echoes the
        // description back — e.g. returning "doubtful; you want specifics..." verbatim instead
        // of a line spoken in that tone. That is a failed render, not a quiet, unusual one: it
        // leaks prompt-internal text to the candidate and reads as the tool describing how it's
        // about to interrogate them rather than opening a round. Same "explicit failure, never
        // silent coercion" rule as ADR-012 — this render has no schema to catch it, so the check
        // is here instead.
        const leaked = PERSONA_VOICE[input.personaId].toLowerCase()
        const rendered = spoken.text.trim().toLowerCase()
        if (rendered !== '' && !rendered.startsWith('voice:') && !rendered.includes(leaked)) {
          brief = spoken.text
        }
      }
      await log.append('state_change', {
        change: 'round_started',
        kind: round,
        index: roundIndex,
        ...(brief === undefined ? {} : { brief }),
        ...(briefInvocation === undefined ? {} : { briefInvocation }),
      })
      deps.io.round(round, roundIndex, input.rounds.length, brief)

      // Simulation withholds feedback until the round ends, but pressure still updates each turn (§4.9).
      const defer = input.mode === 'simulation'
      const withheld: { findings: Finding[] }[] = []

      for (let turn = 0; turn < input.turnsPerRound; turn += 1) {
        // Interleaved, not front-loaded — a session that opens on old gaps announces itself (§4.5).
        const retrieval = turn % 3 === 2 ? takeRetrieval(round, current) : undefined
        if (retrieval !== undefined) {
          const { gap: due, subject } = retrieval
          const retrieved = await runTurn(RETRIEVAL_ACTION[due.competency], round, subject, turn)
          if (retrieved === null) break
          const settled = await recordPracticeOutcome(
            due.id,
            retrieved.attemptId,
            'retrieval',
            retrieved.findings,
          )
          if (settled.kind === 'rejected') {
            rejection = settled.failure
            break
          }
          if (settled.kind === 'applied')
            await recordOutcome(retrieved.findings, retrieved.pressureApplied, subject)
          if (machine.state === 'evaluating') await goto('evaluation_produced')
          continue
        }

        const plan = selectAction({
          subjectIds: subjects.map((subject) => subject.id),
          currentSubjectId: current.id,
          askedCounts,
          coveredForCurrentSubject: coveredBySubject.get(current.id) ?? [],
          recentActions,
          turnCount: turn,
          personaId: input.personaId,
          mode: input.mode,
          pressure,
          round,
          artifactAvailable: current.kind === 'artifact',
          spent: SELECTED_SEEDED.filter((action) => putBefore(current, seedFor(action, current))),
        })
        const planAttemptId = deps.ids.next('att')
        await log.append('plan', {
          attemptId: planAttemptId,
          considered: plan.considered,
          chosen: plan.chosen,
          pressureLevel: plan.pressureLevel,
          ...(plan.nextSubjectId === undefined ? {} : { nextSubjectId: plan.nextSubjectId }),
        })

        if (plan.chosen === 'END_TOPIC') {
          const next = plan.nextSubjectId
          const moved =
            next === undefined ? undefined : subjects.find((subject) => subject.id === next)
          handoffs += 1
          // A free hand-off could bounce forever once every subject is finished; one pass is the whole budget.
          if (moved === undefined || handoffs > subjects.length) {
            outcome.stoppedBy = 'end_topic'
            break
          }
          current = moved
          deps.io.notice(`moving on: ${describe(moved)}`)
          // Moving on asks nothing, so it spends none of the round's questions.
          turn -= 1
          continue
        }

        handoffs = 0
        const asked =
          plan.chosen === 'TRANSFER_TEST' && transferTopic !== undefined
            ? topicSubject(transferTopic)
            : current
        const turned = await runTurn(plan.chosen, round, asked, turn)
        if (turned === null) break

        recentActions.unshift(plan.chosen)
        askedCounts[current.id] = (askedCounts[current.id] ?? 0) + 1
        const probes = ACTIONS[plan.chosen].probes
        if (probes !== null) {
          const covered = coveredBySubject.get(current.id) ?? []
          if (!covered.includes(probes)) coveredBySubject.set(current.id, [...covered, probes])
        }

        let repeatedPractice = false
        if (input.drillGap !== undefined && plan.chosen === 'DRILL') {
          const settled = await recordPracticeOutcome(
            input.drillGap.id,
            turned.attemptId,
            'drill',
            turned.findings,
          )
          if (settled.kind === 'rejected') {
            rejection = settled.failure
            break
          }
          repeatedPractice = settled.kind === 'duplicate'
        }
        if (input.transferGap !== undefined && plan.chosen === 'TRANSFER_TEST') {
          const settled = await recordPracticeOutcome(
            input.transferGap.id,
            turned.attemptId,
            'transfer',
            turned.findings,
          )
          if (settled.kind === 'rejected') {
            rejection = settled.failure
            break
          }
          repeatedPractice = settled.kind === 'duplicate'
          if (!repeatedPractice) {
            deps.io.notice(
              settled.gap.status === 'closed_under_transfer'
                ? 'held under transfer — the gap is closed.'
                : 'the gap did not hold under changed constraints; it reopens.',
            )
          }
        }
        if (!repeatedPractice) await recordOutcome(turned.findings, turned.pressureApplied, asked)

        if (defer) {
          withheld.push({ findings: turned.findings })
        } else if (turned.findings.length > 0) {
          deps.io.findings(turned.findings, quotes)
        }

        if (input.mode === 'coach' && !defer && turned.findings.length > 0) {
          const shaky = !answeredWell(turned.findings)
          if (shaky && machine.state === 'evaluating' && (await deps.io.confirmRetry())) {
            await goto('retry_requested')
            const previous = transcript[transcript.length - 2]?.text
            const retried = await runTurn(plan.chosen, round, asked, turn, previous)
            if (retried === null) break
            await recordOutcome(retried.findings, retried.pressureApplied, asked)
            if (retried.findings.length > 0) deps.io.findings(retried.findings, quotes)
          }
        }

        const target = [...gaps.values()].find((gap) => gap.status === 'open')
        if (
          input.drill &&
          !repeatedPractice &&
          !drilled &&
          target !== undefined &&
          machine.state === 'evaluating'
        ) {
          drilled = true
          await goto('drill_started')
          const drilledOn = gapSubject(target, current)
          const drillTurn = await runTurn('DRILL', round, drilledOn, turn)
          if (drillTurn === null) break
          // Findings remain evidence beside the targeted practice outcome.
          const passed = gapHeld(target, drillTurn.findings)
          const settled = await recordPracticeOutcome(
            target.id,
            drillTurn.attemptId,
            'drill',
            drillTurn.findings,
          )
          if (settled.kind === 'rejected') {
            rejection = settled.failure
            break
          }
          if (settled.kind === 'applied')
            await recordOutcome(drillTurn.findings, drillTurn.pressureApplied, drilledOn)
          if (!defer) {
            if (drillTurn.findings.length > 0) deps.io.findings(drillTurn.findings, quotes)
            deps.io.notice(
              passed
                ? 'drill passed — the gap moves to "drilled". It is not closed: a gap closes only when it holds under transfer, in a later session.'
                : 'drill did not land — the gap stays open.',
            )
          } else {
            withheld.push({ findings: drillTurn.findings })
          }
        }

        // The drill is part of the turn that surfaced the gap, so this stays in `evaluating` until after it.
        if (machine.state === 'evaluating') await goto('evaluation_produced')
      }
      carried = current.id

      if (defer && withheld.length > 0) {
        deps.io.notice(`end of round — ${withheld.length} judgments, withheld until now.`)
        for (const batch of withheld) {
          if (batch.findings.length > 0) deps.io.findings(batch.findings, quotes)
        }
      }
      if (outcome.stoppedBy === 'evaluator_failure' || rejection !== undefined) break
    }
  } catch (error) {
    if (!(error instanceof CeilingBreach)) throw error
    // Ticket 10 §3: a breach is a named failure recorded in the log, never a truncated context.
    await log.append('state_change', {
      change: 'ceiling_breach',
      ceiling: error.ceiling,
      limit: error.limit,
      observed: error.observed,
    })
    deps.io.notice(`ceiling ${error.ceiling} reached — the session stops rather than degrading.`)
    outcome.stoppedBy = 'ceiling'
  }

  const stoppedBy = rejection === undefined ? outcome.stoppedBy : 'practice_outcome_rejected'
  if (rejection !== undefined) deps.io.notice(`practice outcome rejected: ${rejection.kind}`)
  await log.append('state_change', { change: 'session_closed', reason: stoppedBy })
  if (machine.state !== 'closed') await goto('session_closed')

  const saved = { sessionId, view: replay(await deps.store.read(sessionId)) }
  return rejection === undefined
    ? { ...saved, stoppedBy: outcome.stoppedBy }
    : { ...saved, stoppedBy: 'practice_outcome_rejected', failure: rejection }
}
