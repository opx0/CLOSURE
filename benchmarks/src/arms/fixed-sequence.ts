import { evaluateAnswer, gapsFromFindings, indexGaps } from '@levelhead/core'
import type { GapEntry, PolicyAction, Span } from '@levelhead/contracts'
import type { FixtureItem, FixtureResume, ItemOutcome } from '../contract.ts'
import { ItemRecorder, claimFromFixture, findingOutcome, type Arm, type ArmContext } from './arm.ts'

// PROJECT.md §6.1's first arm and ticket 05 §4's baseline for gaps per question — the same questions
// in the same order for every claim, no model call to choose or word them. Deliberately not a bad
// interview: a strawman floor makes the number above it worthless (ticket 16).
const FIXED_SEQUENCE: readonly { action: PolicyAction; text: string }[] = [
  { action: 'PROBE_MECHANISM', text: 'How does it work? Walk me through the mechanism.' },
  {
    action: 'REQUEST_EVIDENCE',
    text: 'What specifically backs that - a number, a file, a commit?',
  },
  {
    action: 'PROBE_TRADE_OFF',
    text: 'What did that choice give up, and what was the alternative?',
  },
  { action: 'TEST_FAILURE_MODE', text: 'Under what conditions does that design stop working?' },
]

// The evaluation path is the same one every other arm uses — a weaker judge would make gaps per
// question a comparison of judges rather than of interviewers.
export const fixedSequenceArm: Arm = {
  id: 'fixed_sequence',
  description: 'a fixed question list, asked in order, with no adaptation and no rendering call',
  // A checklist doesn't read a resume — F1 = 0 would assert it extracted nothing, not that it never
  // extracts.
  extract: null,

  async interrogate(
    item: FixtureItem,
    resume: FixtureResume,
    ctx: ArmContext,
  ): Promise<ItemOutcome> {
    const recorder = new ItemRecorder(item.id, 'fixed_sequence', ctx.ceilings, item.injection)
    const built = claimFromFixture(item, resume, ctx.ids)
    if (built === null) {
      recorder.fail(`fixture claim quote is not in resume ${resume.id}`)
      return recorder.finish()
    }
    recorder.source(resume.id, resume.text)

    const { claim, span } = built
    const transcript: { role: 'interviewer' | 'candidate'; text: string }[] = []
    const gaps = new Map<string, GapEntry>()

    const turns = Math.min(ctx.maxTurns, item.answers.length, FIXED_SEQUENCE.length)
    for (let turn = 0; turn < turns; turn += 1) {
      const scripted = FIXED_SEQUENCE[turn]
      const answer = item.answers[turn]
      if (scripted === undefined || answer === undefined) break

      try {
        recorder.beginTurn()
        recorder.question(scripted.action, scripted.text)
        transcript.push({ role: 'interviewer', text: scripted.text })

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
          action: scripted.action,
          round: 'project_deep_dive',
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

        const { opened } = gapsFromFindings(evaluated.findings, indexGaps([...gaps.values()]), {
          ids: ctx.ids,
          clock: ctx.clock,
        })
        for (const gap of opened) gaps.set(gap.id, gap)
        recorder.gaps(opened)
      } catch (error) {
        recorder.breach(error)
        break
      }
    }

    return recorder.finish()
  },
}
