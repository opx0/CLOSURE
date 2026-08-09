import { createHash } from 'node:crypto'
import { EvaluationOutputSchema, ExtractedClaimsSchema } from '@closer/core'
import type { PolicyAction } from '@closer/contracts'
import type {
  ExtractionOutcome,
  FindingOutcome,
  FixtureItem,
  FixtureResume,
  ItemOutcome,
} from '../contract.ts'
import { ItemRecorder, type Arm, type ArmContext } from './arm.ts'

// The shape ticket 05 §8 names as the thing to stop for: resume in, chat, one JSON judgment out. No
// typed policy, no quote resolution, no pinned rubric, nothing dropped for citing words the
// candidate never said.
//
// Not built to lose — same model, same ceilings, same answers, same output shape asked for, because
// a baseline weakened on purpose makes every number above it meaningless (ticket 16). What it
// doesn't get is the discipline, and the discipline is the hypothesis.
const PROMPT_ID = 'generic-llm-baseline'
const PROMPT_VERSION = 1

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

const EXTRACTION_SYSTEM =
  'You are an expert technical recruiter. Read the resume and list the concrete engineering claims it makes.'

const JUDGMENT_SYSTEM = [
  'You are an expert technical interviewer. Read the interview transcript and judge the claim.',
  'Return findings with a verdict or an abstention, a rationale, a confidence, and the quotes you relied on.',
].join(' ')

// Fixed and claim-independent: a single-prompt interviewer has no state to adapt to, which is the
// property being compared, not a handicap being imposed.
const QUESTIONS: readonly { action: PolicyAction; text: string }[] = [
  { action: 'PROBE_MECHANISM', text: 'Tell me about this project. How did you build it?' },
  { action: 'PROBE_MECHANISM', text: 'Can you go deeper on the technical details?' },
  { action: 'PROBE_TRADE_OFF', text: 'What was the hardest part, and how did you decide?' },
  { action: 'TEST_FAILURE_MODE', text: 'Anything you would do differently?' },
]

interface RawJudgment {
  kind: 'claim' | 'claim_abstained' | 'composure' | 'competency'
  rationale: string
  confidence: number
  quotes: string[]
  verdict?: string
  abstention?: string
  competency?: string
}

export const genericLlmArm: Arm = {
  id: 'generic_llm',
  description:
    'one model call over the whole transcript, no typed policy, no citation resolution, no pinned rubric',

  async extract(resume: FixtureResume, ctx: ArmContext): Promise<ExtractionOutcome> {
    const user = `Resume:\n\n${resume.text}\n\nList every engineering claim, quoting the resume.`
    const result = await ctx.evaluator.complete({
      promptId: `${PROMPT_ID}-extraction`,
      promptVersion: PROMPT_VERSION,
      promptHash: hashOf(EXTRACTION_SYSTEM + user),
      system: EXTRACTION_SYSTEM,
      user,
      schema: ExtractedClaimsSchema,
      schemaName: 'ExtractedClaims',
      maxOutputTokens: 4096,
    })
    if (!result.ok) {
      return {
        resumeId: resume.id,
        armId: 'generic_llm',
        claims: [],
        invocations: [result.invocation],
        failure: result.failure.kind,
      }
    }
    return {
      resumeId: resume.id,
      armId: 'generic_llm',
      // Kept exactly as the model returned them — a quote not in the resume verbatim stays here,
      // where CLOSER would drop the claim, so the precision cost of skipping that check is a number
      // in the report rather than an argument.
      claims: result.value.claims.map((claim) => ({
        quote: claim.quote,
        type: claim.type,
        assertion: claim.assertion,
        spanResolved: resume.text.includes(claim.quote),
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
    const recorder = new ItemRecorder(item.id, 'generic_llm', ctx.ceilings, item.injection)
    recorder.source(resume.id, resume.text)

    const transcript: string[] = []
    const turns = Math.min(ctx.maxTurns, item.answers.length, QUESTIONS.length)
    for (let turn = 0; turn < turns; turn += 1) {
      const question = QUESTIONS[turn]
      const answer = item.answers[turn]
      if (question === undefined || answer === undefined) break
      recorder.beginTurn()
      recorder.question(question.action, question.text)
      recorder.source(`answer:${item.id}:${turn}`, answer.text)
      recorder.answer(answer.text, answer.insufficientEvidence)
      transcript.push(`Interviewer: ${question.text}`, `Candidate: ${answer.text}`)
    }

    // One call at the end, over everything, with the resume and transcript as plain prose — no
    // type-enforced separation of data from instructions, which is why this is also the arm the
    // injection fixtures are expected to land on.
    const user = [
      `Claim under discussion: ${item.claim.assertion}`,
      '',
      `Resume:\n${resume.text}`,
      '',
      `Transcript:\n${transcript.join('\n')}`,
    ].join('\n')

    try {
      recorder.assertCanCall()
      const result = await ctx.evaluator.complete({
        promptId: PROMPT_ID,
        promptVersion: PROMPT_VERSION,
        promptHash: hashOf(JUDGMENT_SYSTEM + user),
        system: JUDGMENT_SYSTEM,
        user,
        schema: EvaluationOutputSchema,
        schemaName: 'answer_evaluation',
        maxOutputTokens: 4096,
      })
      recorder.record(result.invocation)

      if (!result.ok) {
        recorder.fail(`evaluator_failed: ${result.failure.kind}`)
        return recorder.finish()
      }

      // A single judgment can't attribute an abstention to a turn, so the seeded-insufficiency flag
      // is read at item level for this arm — a real limitation of the shape, published rather than
      // smoothed over.
      const unjudgeable = item.answers.every((answer) => answer.insufficientEvidence)

      const judgments = result.value.findings as unknown as readonly RawJudgment[]
      for (const [index, judged] of judgments.entries()) {
        const outcome: FindingOutcome = {
          findingId: `${item.id}:generic:${index}`,
          kind: judged.kind,
          competency:
            judged.competency === 'mechanism' ||
            judged.competency === 'trade_offs' ||
            judged.competency === 'failure_modes' ||
            judged.competency === 'composure'
              ? judged.competency
              : null,
          verdict:
            judged.verdict === 'supported' ||
            judged.verdict === 'partially_supported' ||
            judged.verdict === 'unsupported_by_available_evidence' ||
            judged.verdict === 'contradicted'
              ? judged.verdict
              : null,
          abstention:
            judged.abstention === 'insufficient_evidence' || judged.abstention === 'not_verifiable'
              ? judged.abstention
              : null,
          confidence: judged.confidence,
          rationale: judged.rationale,
          quotes: judged.quotes,
        }
        recorder.finding(outcome, unjudgeable)

        // Every quote becomes a citation, unresolved — this arm's defining behaviour is publishing
        // the model's words as evidence without checking that anyone said them.
        for (const [at, quote] of judged.quotes.entries()) {
          recorder.looseCitation(`${item.id}:generic:${index}:${at}`, quote)
        }
      }
    } catch (error) {
      recorder.breach(error)
    }

    return recorder.finish()
  },
}
