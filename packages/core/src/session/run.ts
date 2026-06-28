import { createHash } from 'node:crypto'
import { PERSONA_VOICE } from '@closer/prompts'
import {
  ACTIONS,
  CeilingBreach,
  CeilingLedger,
  INITIAL_PRESSURE,
  PERSONAS,
  SessionLog,
  applyDrillResult,
  applyRetrievalResult,
  applyTransferResult,
  evaluateAnswer,
  gapsFromFindings,
  indexGaps,
  nextPressure,
  replay,
  rubricSetV1,
  selectAction,
  selectArtifacts,
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
} from '../index.ts'
import type {
  Artifact,
  Claim,
  Competency,
  EventOf,
  Evidence,
  Finding,
  GapEntry,
  Level,
  Mode,
  PersonaId,
  PolicyAction,
  RoleId,
  RoundKind,
  Session,
  SessionState,
  Snapshot,
} from '@closer/contracts'

export interface SessionIo {
  round(kind: RoundKind, index: number, total: number, brief?: string): void
  question(
    text: string,
    meta: { turn: number; action: PolicyAction; pressureLevel: number; round: RoundKind },
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
  mode: Mode
  level: Level
  personaId: PersonaId
  role?: RoleId
  pressureCeiling: PressureLevel
  rounds: readonly RoundKind[]
  turnsPerRound: number
  drill: boolean
  transferGap?: GapEntry
  // Gaps due for spaced retrieval; asked as ordinary questions, never announced as reviews (§4.5).
  retrievals?: readonly GapEntry[]
  pinned?: PinnedContext
  ceilings: Ceilings
  deps: SessionDeps
}

export interface SessionResult {
  sessionId: string
  view: SessionView
  stoppedBy: 'turns' | 'end_topic' | 'ceiling' | 'evaluator_failure'
}

// Seed content is chosen by code, not the model — e.g. FALSE_PREMISE's wrong statement can't drift (ticket 05 §3).
function seedFor(action: PolicyAction, claim: Claim | null): string | undefined {
  if (!ACTIONS[action].needsSeed) return undefined
  const technology = claim?.technologies[0] ?? 'the system'
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
      return `the same idea in a system that is not ${technology}`
    default:
      return undefined
  }
}

// Abstention is not a pass — the Evaluator declining to judge says nothing about whether the gap closed.
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

  const session: Session = {
    id: sessionId,
    mode: input.mode,
    level: input.level,
    personaId: input.personaId,
    pressureLevel: pressure.level,
    pressureCeiling: ceiling,
    rubricSet: rubricSetV1,
    claimIds: inPlay.map((claim) => claim.id),
    rounds: [...input.rounds],
    ...(input.pinned === undefined ? {} : { snapshotId: input.pinned.snapshot.id }),
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
  for (const gap of pendingRetrievals) {
    await log.append('state_change', { change: 'gap_opened', gap })
  }
  if (input.transferGap !== undefined) {
    // Re-opened as a fresh event so this session's log replays standalone; the ledger merges by id.
    await log.append('state_change', { change: 'gap_opened', gap: input.transferGap })
  }

  const transcript: { role: 'interviewer' | 'candidate'; text: string }[] = []
  const recentActions: PolicyAction[] = []
  const gaps = new Map<string, GapEntry>()
  const quotes = new Map<string, string>()
  // Same reason as `machine` above: assigned from closures.
  const outcome: { stoppedBy: SessionResult['stoppedBy'] } = { stoppedBy: 'turns' }
  let drilled = false
  let currentClaim: Claim | null = inPlay[0] ?? null

  const RETRIEVAL_ACTION: Record<Competency, PolicyAction> = {
    mechanism: 'PROBE_MECHANISM',
    failure_modes: 'TEST_FAILURE_MODE',
    trade_offs: 'PROBE_TRADE_OFF',
    composure: 'SUSTAINED_CHALLENGE',
  }

  const artifactFor = async (
    claim: Claim | null,
    round: RoundKind,
  ): Promise<ArtifactContext | undefined> => {
    if (input.pinned === undefined || round !== 'code_walkthrough' || claim === null)
      return undefined
    const [artifact] = selectArtifacts(input.pinned.artifacts, claim, 1)
    if (artifact === undefined) return undefined
    const code = await input.pinned.repository.read(artifact)
    // A snapshot is deletable (§7); if the code is gone, skip the walkthrough rather than degrade to a citation-less question.
    if (code === null) return undefined
    return {
      artifactId: artifact.id,
      path: artifact.path,
      ...(artifact.symbol === undefined ? {} : { symbol: artifact.symbol }),
      ...(artifact.startLine === undefined ? {} : { startLine: artifact.startLine }),
      ...(artifact.endLine === undefined ? {} : { endLine: artifact.endLine }),
      code,
    }
  }

  interface TurnResult {
    attemptId: string
    findings: Finding[]
    pressureApplied: boolean
  }

  const runTurn = async (
    action: PolicyAction,
    round: RoundKind,
    claim: Claim | null,
    turn: number,
    reuseQuestion?: string,
  ): Promise<TurnResult | null> => {
    // One attempt is one turn for budgeting: a drill/retry is charged its own turn, not the one that surfaced it.
    ceilings.beginTurn()
    const attemptId = deps.ids.next('att')
    const artifact = await artifactFor(claim, round)
    await log.append('policy_action', {
      attemptId,
      action,
      round,
      pressureLevel: pressure.level,
      ...(claim === null ? {} : { claimId: claim.id }),
      ...(artifact === undefined ? {} : { artifactId: artifact.artifactId }),
    })
    if (machine.state === 'selecting') await goto('action_selected')

    let text = reuseQuestion
    if (text === undefined) {
      const seed = seedFor(action, claim)
      ceilings.assertCanCall()
      const rendered = await deps.conductor.renderQuestion({
        action,
        round,
        pressureLevel: pressure.level,
        level: input.level,
        personaId: input.personaId,
        claim,
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

    deps.io.question(text, { turn, action, pressureLevel: pressure.level, round })
    transcript.push({ role: 'interviewer', text })

    const answerText = await deps.io.answer()
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

  const recordOutcome = async (findings: readonly Finding[], pressureApplied: boolean) => {
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

    const { opened, transitions } = gapsFromFindings(findings, indexGaps([...gaps.values()]), {
      ids: deps.ids,
      clock: deps.clock,
    })
    for (const gap of opened) {
      await log.append('state_change', { change: 'gap_opened', gap })
      gaps.set(gap.id, gap)
    }
    for (const change of transitions) {
      await log.append('state_change', {
        change: 'gap_status',
        gapId: change.gapId,
        from: change.from,
        to: change.to,
      })
      const existing = gaps.get(change.gapId)
      if (existing) gaps.set(change.gapId, { ...existing, status: change.to })
    }
  }

  try {
    for (const [roundIndex, round] of input.rounds.entries()) {
      // Reset per round, not per session — coverage in one round doesn't count in the next (§4.7).
      const coveredByClaim = new Map<string, Competency[]>()
      const askedCounts: Record<string, number> = {}
      let handoffs = 0
      let brief: string | undefined
      if (deps.conductor.renderRoundBrief !== undefined) {
        ceilings.beginTurn()
        ceilings.assertCanCall()
        const spoken = await deps.conductor.renderRoundBrief({
          round,
          roundIndex,
          totalRounds: input.rounds.length,
          personaId: input.personaId,
          claim: currentClaim,
        })
        ceilings.record(spoken.invocation)
        // A weak model asked to speak "in" a described voice sometimes just echoes the
        // description back — e.g. returning "doubtful; you want specifics..." verbatim instead
        // of a line spoken in that tone. That is a failed render, not a quiet, unusual one: it
        // leaks prompt-internal text to the candidate and reads as the tool describing how it's
        // about to interrogate them rather than opening a round. Same "explicit failure, never
        // silent coercion" rule as ADR-012 — this render has no schema to catch it, so the check
        // is here instead.
        const leaked = PERSONA_VOICE[input.personaId].toLowerCase()
        const rendered = spoken.text.toLowerCase()
        if (!rendered.startsWith('voice:') && !rendered.includes(leaked)) {
          brief = spoken.text
        }
      }
      await log.append('state_change', {
        change: 'round_started',
        kind: round,
        index: roundIndex,
        ...(brief === undefined ? {} : { brief }),
      })
      deps.io.round(round, roundIndex, input.rounds.length, brief)

      // Simulation withholds feedback until the round ends, but pressure still updates each turn (§4.9).
      const defer = input.mode === 'simulation'
      const withheld: { findings: Finding[] }[] = []

      for (let turn = 0; turn < input.turnsPerRound; turn += 1) {
        // Interleaved, not front-loaded — a session that opens on old gaps announces itself (§4.5).
        const due = turn % 3 === 2 ? pendingRetrievals.shift() : undefined
        if (due !== undefined) {
          const onClaim = inPlay.find((claim) => claim.id === due.claimId) ?? currentClaim
          const retrieved = await runTurn(RETRIEVAL_ACTION[due.competency], round, onClaim, turn)
          if (retrieved === null) break
          const held = answeredWell(retrieved.findings)
          const settled = applyRetrievalResult(due, retrieved.attemptId, held, {
            clock: deps.clock,
          })
          if (settled.transition !== null) {
            await log.append('state_change', {
              change: 'gap_status',
              gapId: settled.transition.gapId,
              from: settled.transition.from,
              to: settled.transition.to,
              attemptId: retrieved.attemptId,
            })
          }
          gaps.set(settled.gap.id, settled.gap)
          await recordOutcome(retrieved.findings, retrieved.pressureApplied)
          if (machine.state === 'evaluating') await goto('evaluation_produced')
          continue
        }

        const claimId = currentClaim?.id ?? null
        const plan = selectAction({
          confirmedClaimIds: inPlay.map((claim) => claim.id),
          currentClaimId: claimId,
          askedCounts,
          coveredForCurrentClaim: claimId === null ? [] : (coveredByClaim.get(claimId) ?? []),
          recentActions,
          turnCount: turn,
          personaId: input.personaId,
          mode: input.mode,
          pressure,
          round,
          artifactAvailable: (await artifactFor(currentClaim, round)) !== undefined,
        })
        const planAttemptId = deps.ids.next('att')
        await log.append('plan', {
          attemptId: planAttemptId,
          considered: plan.considered,
          chosen: plan.chosen,
          pressureLevel: plan.pressureLevel,
          ...(plan.nextClaimId === undefined ? {} : { nextClaimId: plan.nextClaimId }),
        })

        if (plan.chosen === 'END_TOPIC') {
          const next = plan.nextClaimId
          const moved = next === undefined ? undefined : inPlay.find((c) => c.id === next)
          if (moved === undefined) {
            outcome.stoppedBy = 'end_topic'
            break
          }
          currentClaim = moved
          deps.io.notice(`moving on: ${moved.assertion}`)
          handoffs += 1
          // A free hand-off could bounce forever once every claim is finished; one pass is the whole budget.
          if (handoffs > inPlay.length) {
            outcome.stoppedBy = 'end_topic'
            break
          }
          continue
        }

        handoffs = 0
        const turned = await runTurn(plan.chosen, round, currentClaim, turn)
        if (turned === null) break

        recentActions.unshift(plan.chosen)
        if (claimId !== null) askedCounts[claimId] = (askedCounts[claimId] ?? 0) + 1
        const probes = ACTIONS[plan.chosen].probes
        if (probes !== null && claimId !== null) {
          const covered = coveredByClaim.get(claimId) ?? []
          if (!covered.includes(probes)) coveredByClaim.set(claimId, [...covered, probes])
        }

        await recordOutcome(turned.findings, turned.pressureApplied)

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
            const retried = await runTurn(plan.chosen, round, currentClaim, turn, previous)
            if (retried === null) break
            await recordOutcome(retried.findings, retried.pressureApplied)
            if (retried.findings.length > 0) deps.io.findings(retried.findings, quotes)
          }
        }

        // The attempt that closes the gap is recorded — a closed row needs an attempt behind it.
        if (input.transferGap !== undefined && plan.chosen === 'TRANSFER_TEST') {
          const carried = gaps.get(input.transferGap.id) ?? input.transferGap
          const outcome = applyTransferResult(
            carried,
            turned.attemptId,
            answeredWell(turned.findings),
            { clock: deps.clock },
          )
          if (outcome.transition !== null) {
            await log.append('state_change', {
              change: 'gap_status',
              gapId: outcome.transition.gapId,
              from: outcome.transition.from,
              to: outcome.transition.to,
              attemptId: turned.attemptId,
            })
          }
          gaps.set(outcome.gap.id, outcome.gap)
          deps.io.notice(
            outcome.gap.status === 'closed_under_transfer'
              ? 'held under transfer — the gap is closed.'
              : 'the gap did not hold under changed constraints; it reopens.',
          )
        }

        const target = [...gaps.values()].find((gap) => gap.status === 'open')
        if (input.drill && !drilled && target !== undefined && machine.state === 'evaluating') {
          drilled = true
          await goto('drill_started')
          const drillTurn = await runTurn('DRILL', round, currentClaim, turn)
          if (drillTurn === null) break
          // A drill answer is still an answer — recordOutcome keeps it in the ledger, not just applyDrillResult.
          await recordOutcome(drillTurn.findings, drillTurn.pressureApplied)
          const passed = answeredWell(drillTurn.findings)
          const result = applyDrillResult(target, passed, { clock: deps.clock })
          if (result.transition !== null) {
            await log.append('state_change', {
              change: 'gap_status',
              gapId: result.transition.gapId,
              from: result.transition.from,
              to: result.transition.to,
            })
            gaps.set(result.gap.id, result.gap)
          }
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

      if (defer && withheld.length > 0) {
        deps.io.notice(`end of round — ${withheld.length} judgments, withheld until now.`)
        for (const batch of withheld) {
          if (batch.findings.length > 0) deps.io.findings(batch.findings, quotes)
        }
      }
      if (outcome.stoppedBy === 'evaluator_failure') break
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

  await log.append('state_change', { change: 'session_closed', reason: outcome.stoppedBy })
  if (machine.state !== 'closed') await goto('session_closed')

  return { sessionId, view: replay(await deps.store.read(sessionId)), stoppedBy: outcome.stoppedBy }
}
