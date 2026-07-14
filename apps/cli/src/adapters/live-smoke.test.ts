import { expect, test } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { answerEvaluationPrompt } from '@closer/prompts'
import { StructuredEvaluator } from './evaluator-structured.ts'
import { defaultResilience } from './resilience.ts'

// STACK §9.5: a deterministic fake backs unit tests and recorded fixtures back integration tests,
// but neither replaces a small live call — provider behaviour changes without notice, and a fully
// mocked model boundary tests only the mock. So this exists, and it is behind an explicit opt-in
// and a cost limit, because a live call on every pull request is how a test suite becomes a bill.
//
//   CLOSER_LIVE_SMOKE=1 MODEL_PROVIDER_API_KEY=... bun test apps/cli/src/adapters/live-smoke
//
// It asserts the *contract*, never the prose: that a real provider returns something the schema
// accepts, or a named failure — and never a coerced result. What the model actually said is not
// asserted, because a test that asserts an LLM produced specific words is a flaky test.

// A hard ceiling on this one call, checked after the fact. Chosen in advance; it is not a
// measurement, and a run that exceeds it is a failure rather than a surprising invoice.
const COST_CEILING_USD = 0.05

const enabled = process.env.CLOSER_LIVE_SMOKE === '1'
const apiKey = process.env.MODEL_PROVIDER_API_KEY
const modelAlias = process.env.MODEL_ID ?? 'claude-opus-5'

const ShapeSchema = Type.Object(
  {
    findings: Type.Array(
      Type.Object(
        {
          kind: Type.Literal('claim'),
          verdict: Type.Union([
            Type.Literal('supported'),
            Type.Literal('partially_supported'),
            Type.Literal('unsupported_by_available_evidence'),
            Type.Literal('contradicted'),
          ]),
          rationale: Type.String({ minLength: 1 }),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
          quotes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const ANSWER = 'We leased each job for thirty seconds. I do not think we handled double completion.'

if (!enabled || apiKey === undefined) {
  test.skip('live model smoke: set CLOSER_LIVE_SMOKE=1 and MODEL_PROVIDER_API_KEY to run', () => {})
} else {
  test('a real provider returns a schema-valid result or a named failure, and stays under the cost ceiling', async () => {
    const evaluator = new StructuredEvaluator({
      modelAlias,
      apiKey,
      localBaseUrl: 'http://localhost:8081/v1',
      resilience: defaultResilience(1),
    })

    const result = await evaluator.complete({
      promptId: answerEvaluationPrompt.id,
      promptVersion: answerEvaluationPrompt.version,
      promptHash: answerEvaluationPrompt.hash,
      system:
        'You judge one interview answer. Quote the candidate verbatim. Return only the schema.',
      user: `The claim: built a durable job queue on PostgreSQL.\nThe answer: ${ANSWER}`,
      schema: ShapeSchema,
      schemaName: 'live_smoke',
      maxOutputTokens: 512,
    })

    // Attributable either way: a failure still carries an invocation record, which is the row that
    // makes a provenance system a provenance system.
    expect(result.invocation.modelAlias).toBe(modelAlias)
    expect(result.invocation.promptHash).toBe(answerEvaluationPrompt.hash)
    expect(result.invocation.costUsd).toBeLessThanOrEqual(COST_CEILING_USD)

    if (!result.ok) {
      // A named failure is a correct outcome here. What must never happen is a coerced one.
      expect(['refusal', 'max_tokens', 'unparseable', 'schema_mismatch', 'transport']).toContain(
        result.failure.kind,
      )
      return
    }

    expect(result.invocation.inputTokens).toBeGreaterThan(0)
    expect(result.invocation.outputTokens).toBeGreaterThan(0)
    for (const finding of result.value.findings) {
      // The contract, not the prose: every finding quotes something, and nothing was invented into
      // a shape the schema did not ask for.
      expect(finding.quotes.length).toBeGreaterThan(0)
    }
  }, 120_000)
}
