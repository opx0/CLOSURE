import { createHash } from 'node:crypto'
import { ClaimEvaluationOutputSchema } from '@levelhead/core'
import type { PolicyAction } from '@levelhead/contracts'
import type {
  FindingOutcome,
  FixtureChunk,
  FixtureItem,
  FixtureResume,
  ItemOutcome,
} from '../contract.ts'
import { ItemRecorder, type Arm, type ArmContext } from './arm.ts'

// PROJECT.md §6.1's third arm, and the opponent ticket 05 §8(b) measures provenance against:
// retrieval over the repository, quoted back as evidence. If Levelhead's evidence-link quality isn't
// separated from this arm's, the provenance machinery isn't earning its place.
//
// Retrieval is bag-of-words overlap — a real retrieval baseline, not a caricature, but ticket 16
// requires the fixture to give this arm a corpus with genuine distractors, not one relevant file.
const PROMPT_ID = 'repo-rag-baseline'
const PROMPT_VERSION = 1
const TOP_K = 3

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((word) => word.length > 2),
  )
}

export function retrieve(
  chunks: readonly FixtureChunk[],
  query: string,
  k = TOP_K,
): FixtureChunk[] {
  const wanted = terms(query)
  return [...chunks]
    .map((chunk) => {
      const have = terms(chunk.text)
      let overlap = 0
      for (const word of wanted) if (have.has(word)) overlap += 1
      return { chunk, overlap }
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, k)
    .filter((scored) => scored.overlap > 0)
    .map((scored) => scored.chunk)
}

const SYSTEM = [
  'You are a technical interviewer with access to the candidate repository.',
  'Judge the claim against the retrieved code and the transcript, quoting what you relied on.',
].join(' ')

const QUESTIONS: readonly { action: PolicyAction; text: string }[] = [
  {
    action: 'PROBE_MECHANISM',
    text: 'I pulled up the relevant code. Walk me through what it does.',
  },
  {
    action: 'REQUEST_EVIDENCE',
    text: 'Where in the repository does that behaviour actually live?',
  },
  {
    action: 'PROBE_TRADE_OFF',
    text: 'The code takes one approach here. What was the alternative?',
  },
  {
    action: 'TEST_FAILURE_MODE',
    text: 'What happens to this code path when the assumption breaks?',
  },
]

interface RawJudgment {
  kind: 'claim' | 'claim_abstained' | 'composure' | 'competency'
  rationale: string
  confidence: number
  quotes: string[]
  verdict?: string
  abstention?: string
}

export const repoRagArm: Arm = {
  id: 'repo_rag',
  description: 'retrieval over the repository chunks, quoted back as evidence without resolution',
  // Retrieval answers questions about code, not a resume — F1 would be a number for something it
  // doesn't do.
  extract: null,

  async interrogate(
    item: FixtureItem,
    resume: FixtureResume,
    ctx: ArmContext,
  ): Promise<ItemOutcome> {
    const recorder = new ItemRecorder(item.id, 'repo_rag', ctx.ceilings, item.injection)
    recorder.source(resume.id, resume.text)

    const transcript: string[] = []
    const turns = Math.min(ctx.maxTurns, item.answers.length, QUESTIONS.length)

    for (let turn = 0; turn < turns; turn += 1) {
      const question = QUESTIONS[turn]
      const answer = item.answers[turn]
      if (question === undefined || answer === undefined) break

      try {
        recorder.beginTurn()
        const query = `${item.claim.assertion} ${transcript.join(' ')}`
        const retrieved = retrieve(item.repoChunks, query)
        // Registered as sources so a citation into retrieved code is checked by the same rule as a
        // citation into an answer — retrieval is not a licence to cite loosely.
        for (const chunk of retrieved) recorder.source(`repo:${chunk.path}`, chunk.text)

        recorder.question(question.action, question.text)
        const answerSourceId = `answer:${item.id}:${turn}`
        recorder.source(answerSourceId, answer.text)
        recorder.answer(answer.text, answer.insufficientEvidence)
        transcript.push(`Interviewer: ${question.text}`, `Candidate: ${answer.text}`)

        const user = [
          `Claim: ${item.claim.assertion}`,
          '',
          `Retrieved code:\n${retrieved.map((chunk) => `--- ${chunk.path}\n${chunk.text}`).join('\n')}`,
          '',
          `Transcript:\n${transcript.join('\n')}`,
        ].join('\n')

        recorder.assertCanCall()
        const result = await ctx.evaluator.complete({
          promptId: PROMPT_ID,
          promptVersion: PROMPT_VERSION,
          promptHash: hashOf(SYSTEM + user),
          system: SYSTEM,
          user,
          schema: ClaimEvaluationOutputSchema,
          schemaName: 'answer_evaluation',
          maxOutputTokens: 4096,
        })
        recorder.record(result.invocation)

        if (!result.ok) {
          recorder.fail(`evaluator_failed: ${result.failure.kind}`)
          break
        }

        const judgments = result.value.findings as unknown as readonly RawJudgment[]
        for (const [index, judged] of judgments.entries()) {
          const outcome: FindingOutcome = {
            findingId: `${item.id}:rag:${turn}:${index}`,
            kind: judged.kind,
            competency: null,
            verdict:
              judged.verdict === 'supported' ||
              judged.verdict === 'partially_supported' ||
              judged.verdict === 'unsupported_by_available_evidence' ||
              judged.verdict === 'contradicted'
                ? judged.verdict
                : null,
            abstention:
              judged.abstention === 'insufficient_evidence' ||
              judged.abstention === 'not_verifiable'
                ? judged.abstention
                : null,
            confidence: judged.confidence,
            rationale: judged.rationale,
            quotes: judged.quotes,
          }
          recorder.finding(outcome, answer.insufficientEvidence)
          for (const [at, quote] of judged.quotes.entries()) {
            recorder.looseCitation(`${item.id}:rag:${turn}:${index}:${at}`, quote)
          }
        }
      } catch (error) {
        recorder.breach(error)
        break
      }
    }

    return recorder.finish()
  },
}
