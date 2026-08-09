import {
  ACTIONS,
  ACTION_ORDER,
  INITIAL_PRESSURE,
  evaluateAnswer,
  extractClaims,
  gapsFromFindings,
  indexGaps,
  nextPressure,
  selectAction,
  type PressureState,
} from '@closer/core'
import type { Competency, GapEntry, PolicyAction, RoundKind, Span } from '@closer/contracts'
import type {
  ArmId,
  ExtractionOutcome,
  FixtureItem,
  FixtureResume,
  ItemOutcome,
} from '../contract.ts'
import { ItemRecorder, claimFromFixture, findingOutcome, type Arm, type ArmContext } from './arm.ts'

// The round every session has — comparing arms across different round arcs would be comparing
// interviews, not interviewers.
const ROUND: RoundKind = 'project_deep_dive'

// Both policies are handed exactly this, so neither can win by reading something the other could
// not.
export interface PolicyTurn {
  claimId: string
  askedCounts: Readonly<Record<string, number>>
  covered: readonly Competency[]
  recentActions: readonly PolicyAction[]
  turnCount: number
  pressure: PressureState
  ctx: ArmContext
}

export interface ArmPolicy {
  id: 'typed' | 'fixed_order'
  description: string
  next(turn: PolicyTurn): PolicyAction
}

// `selectAction` from packages/core — the same function the CLI's session loop calls.
export const typedPolicy: ArmPolicy = {
  id: 'typed',
  description: 'packages/core selectAction: the typed policy, choosing each action from the state',
  next(turn) {
    return selectAction({
      confirmedClaimIds: [turn.claimId],
      currentClaimId: turn.claimId,
      askedCounts: turn.askedCounts,
      coveredForCurrentClaim: turn.covered,
      recentActions: turn.recentActions,
      turnCount: turn.turnCount,
      personaId: turn.ctx.personaId,
      mode: turn.ctx.mode,
      pressure: turn.pressure,
      round: ROUND,
    }).chosen
  },
}

// Ticket 05 §8(a)'s ablation: not "policy disabled", a fixed order — the arm still asks the same
// *kinds* of question in the same numbers, only the adaptation is gone. Disabling the policy
// outright would ablate the questions too and measure the question set instead.
export const FIXED_ORDER: readonly PolicyAction[] = ACTION_ORDER.filter(
  (action) => ACTIONS[action].probes !== null && !ACTIONS[action].isPressure,
)

export const fixedOrderPolicy: ArmPolicy = {
  id: 'fixed_order',
  description: 'the same action catalogue in a fixed cycle, with no reading of the session state',
  next(turn) {
    return FIXED_ORDER[turn.turnCount % FIXED_ORDER.length] ?? 'PROBE_MECHANISM'
  },
}

// Content the action needs that the renderer may not invent — chosen by code here, as the CLI does,
// so anything untrue CLOSER says is in the log as data.
function seedFor(action: PolicyAction, technology: string): string | undefined {
  if (!ACTIONS[action].needsSeed) return undefined
  switch (action) {
    case 'FALSE_PREMISE':
      return `${technology} already guarantees this on its own, so the application never has to handle the duplicate case.`
    case 'CONSTRAINT_SHOCK':
      return 'the volume is now 100x what you described, and the deadline is unchanged'
    case 'APPEAL_TO_AUTHORITY':
      return 'a staff engineer who reviewed this said the approach is wrong'
    case 'CHANGE_CONSTRAINT':
      return `the same requirement, but ${technology} is no longer available to you`
    case 'DRILL':
      return 'the missing piece, produced rather than explained'
    case 'TRANSFER_TEST':
      return `the same idea in a system that is not ${technology}`
    default:
      return undefined
  }
}

// Both CLOSER arms are this function with only `policy` differing — what makes ticket 05 §8(a) a
// real ablation rather than two implementations that happen to disagree elsewhere.
export function closerArm(id: ArmId, description: string, policy: ArmPolicy): Arm {
  return {
    id,
    description,

    async extract(resume: FixtureResume, ctx: ArmContext): Promise<ExtractionOutcome> {
      const result = await extractClaims({
        resumeText: resume.text,
        sourceId: resume.id,
        evaluator: ctx.evaluator,
        ids: ctx.ids,
        clock: ctx.clock,
      })
      if ('failed' in result) {
        return {
          resumeId: resume.id,
          armId: id,
          claims: [],
          invocations: [result.invocation],
          failure: result.failed.kind,
        }
      }
      const quoted = new Map(result.spans.map((span) => [span.id, span.quoted]))
      return {
        resumeId: resume.id,
        armId: id,
        claims: result.claims.map((claim) => ({
          quote: quoted.get(claim.spanId) ?? '',
          type: claim.type,
          assertion: claim.assertion,
          // Always true for this arm: `extractClaims` drops a claim whose quote isn't in the resume
          // verbatim, so an unresolvable quote costs it recall here and costs a baseline precision
          // there.
          spanResolved: true,
        })),
        invocations: [result.invocation],
        failure: null,
      }
    },

    async interrogate(
      item: FixtureItem,
      resume: FixtureResume,
      ctx: ArmContext,
    ): Promise<ItemOutcome> {
      const recorder = new ItemRecorder(item.id, id, ctx.ceilings, item.injection)
      const built = claimFromFixture(item, resume, ctx.ids)
      if (built === null) {
        recorder.fail(`fixture claim quote is not in resume ${item.resumeId}`)
        return recorder.finish()
      }
      recorder.source(resume.id, resume.text)

      const { claim, span } = built
      const technology = claim.technologies[0] ?? 'the system'
      const transcript: { role: 'interviewer' | 'candidate'; text: string }[] = []
      const askedCounts: Record<string, number> = {}
      const recentActions: PolicyAction[] = []
      const covered: Competency[] = []
      const gaps = new Map<string, GapEntry>()
      let pressure: PressureState = INITIAL_PRESSURE

      const turns = Math.min(ctx.maxTurns, item.answers.length)
      for (let turn = 0; turn < turns; turn += 1) {
        const answer = item.answers[turn]
        if (answer === undefined) break

        const action = policy.next({
          claimId: claim.id,
          askedCounts,
          covered,
          recentActions,
          turnCount: turn,
          pressure,
          ctx,
        })
        // Nothing left to ask — asking anyway would inflate the denominator of gaps per question.
        if (action === 'END_TOPIC') break

        try {
          recorder.beginTurn()
          recorder.assertCanCall()
          const seed = seedFor(action, technology)
          const rendered = await ctx.conductor.renderQuestion({
            action,
            round: ROUND,
            pressureLevel: pressure.level,
            level: ctx.level,
            personaId: ctx.personaId,
            claim,
            transcript,
            ...(seed === undefined ? {} : { seed }),
          })
          recorder.record(rendered.invocation)
          recorder.question(action, rendered.text)
          transcript.push({ role: 'interviewer', text: rendered.text })

          const attemptId = ctx.ids.next('att')
          const answerSourceId = `answer:${attemptId}`
          recorder.source(answerSourceId, answer.text)
          recorder.answer(answer.text, answer.insufficientEvidence)
          transcript.push({ role: 'candidate', text: answer.text })

          recorder.assertCanCall()
          const evaluated = await evaluateAnswer({
            attemptId,
            claim,
            claimSpanId: span.id,
            action,
            round: ROUND,
            level: ctx.level,
            answerText: answer.text,
            answerSourceId,
            transcript,
            rubricSet: ctx.rubricSet,
            evaluator: ctx.evaluator,
            ids: ctx.ids,
            clock: ctx.clock,
          })
          recorder.record(evaluated.invocation)

          if ('failed' in evaluated) {
            // Never an evaluation that found nothing — continuing would publish an item that looks
            // complete and judged nothing.
            recorder.fail(`evaluator_failed: ${evaluated.failed.kind}`)
            break
          }

          const spans: ReadonlyMap<string, Span> = new Map(
            [span, ...evaluated.spans].map((each) => [each.id, each]),
          )
          for (const finding of evaluated.findings) {
            recorder.finding(findingOutcome(finding, spans), answer.insufficientEvidence)
          }
          recorder.evidence(evaluated.evidence, spans)

          const { opened, transitions } = gapsFromFindings(
            evaluated.findings,
            indexGaps([...gaps.values()]),
            { ids: ctx.ids, clock: ctx.clock },
          )
          for (const gap of opened) gaps.set(gap.id, gap)
          for (const change of transitions) {
            const known = gaps.get(change.gapId)
            if (known !== undefined) gaps.set(change.gapId, { ...known, status: change.to })
          }
          recorder.gaps(opened)

          const signals = evaluated.findings.flatMap((finding) =>
            finding.kind === 'composure' ? finding.signals : [],
          )
          pressure = nextPressure(pressure, signals, {
            mode: ctx.mode,
            ceiling: 3,
            pressureApplied: ACTIONS[action].isPressure,
          }).state

          recentActions.unshift(action)
          askedCounts[claim.id] = (askedCounts[claim.id] ?? 0) + 1
          const probes = ACTIONS[action].probes
          if (probes !== null && !covered.includes(probes)) covered.push(probes)
        } catch (error) {
          recorder.breach(error)
          break
        }
      }

      return recorder.finish()
    },
  }
}
