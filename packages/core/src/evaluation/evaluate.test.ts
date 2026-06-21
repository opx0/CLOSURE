import { test, expect } from 'bun:test'
import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Claim, InvocationRecord, PolicyAction } from '@closer/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { EvaluatorPort, StructuredRequest, StructuredResult } from '../ports/evaluator.ts'
import {
  EvaluationOutputSchema,
  evaluateAnswer,
  type EvaluateAnswerInput,
  type EvaluationOutput,
  type EvaluationResult,
} from './evaluate.ts'
import { rubricSetV1 } from './rubrics.ts'

const ANSWER =
  'The worker takes a lease with a thirty second expiry and renews it while it works. ' +
  'If it dies the lease expires and another worker picks the job up. ' +
  "I don't think we handled that."

const CLAIM: Claim = {
  id: 'claim-1',
  spanId: 'resume-span-1',
  type: 'built',
  assertion: 'Built a durable job queue on PostgreSQL',
  technologies: ['PostgreSQL'],
  metrics: [],
  implied: false,
  confirmedByCandidate: true,
  extractorVersion: 'claim-extraction@1',
}

const INVOCATION: InvocationRecord = {
  id: 'invocation-1',
  port: 'evaluator',
  modelAlias: 'test-model-alias',
  promptId: 'answer-evaluation',
  promptVersion: 1,
  promptHash: 'deadbeef',
  inputTokens: 900,
  outputTokens: 200,
  costUsd: 0.004,
  stopReason: 'end_turn',
  latencyMs: 42,
  occurredAt: '2026-09-09T10:00:00.000Z',
}

function fakeEvaluator(result: StructuredResult<EvaluationOutput>): {
  port: EvaluatorPort
  requests: StructuredRequest<TSchema>[]
} {
  const requests: StructuredRequest<TSchema>[] = []
  const port: EvaluatorPort = {
    complete: async <T extends TSchema>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult<Static<T>>> => {
      requests.push(request)
      return result as unknown as StructuredResult<Static<T>>
    },
  }
  return { port, requests }
}

function idSource(): IdSource {
  let issued = 0
  return { next: (prefix) => `${prefix}-${(issued += 1)}` }
}

const clock: Clock = { now: () => '2026-09-09T10:00:00.000Z' }

function inputFor(
  evaluator: EvaluatorPort,
  over: { action?: PolicyAction; claim?: Claim | null; claimSpanId?: string } = {},
): EvaluateAnswerInput {
  return {
    attemptId: 'attempt-1',
    claim: over.claim === undefined ? CLAIM : over.claim,
    ...(over.claimSpanId === undefined ? {} : { claimSpanId: over.claimSpanId }),
    action: over.action ?? 'PROBE_MECHANISM',
    round: 'project_deep_dive',
    level: 'senior',
    answerText: ANSWER,
    answerSourceId: 'answer-source-1',
    transcript: [
      { role: 'interviewer', text: 'When does that queue fail?' },
      { role: 'candidate', text: ANSWER },
    ],
    rubricSet: rubricSetV1,
    evaluator,
    ids: idSource(),
    clock,
  }
}

function ok(result: EvaluationResult): Extract<EvaluationResult, { findings: unknown[] }> {
  if ('failed' in result) throw new Error(`expected an evaluation, got ${result.failed.kind}`)
  return result
}

function everyCitationResolves(result: Extract<EvaluationResult, { findings: unknown[] }>): void {
  const bytes = new TextEncoder().encode(ANSWER)
  const decoder = new TextDecoder()
  for (const finding of result.findings) {
    expect(finding.transcriptSpanIds.length).toBeGreaterThan(0)
    expect(finding.evidenceIds.length).toBeGreaterThan(0)
    for (const spanId of finding.transcriptSpanIds) {
      const span = result.spans.find((candidate) => candidate.id === spanId)
      expect(span).toBeDefined()
      if (span === undefined) continue
      expect(decoder.decode(bytes.slice(span.startByte, span.endByte))).toBe(span.quoted)
      expect(ANSWER).toContain(span.quoted)
    }
    for (const evidenceId of finding.evidenceIds) {
      expect(result.evidence.some((link) => link.id === evidenceId)).toBe(true)
    }
  }
}

test('a finding whose quote is not in the answer is dropped and the rest still resolve', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'competency',
        competency: 'mechanism',
        levelMet: 'mid',
        rationale: 'Lease-based recovery is described end to end.',
        confidence: 0.8,
        quotes: ['takes a lease with a thirty second expiry', 'another worker picks the job up'],
      },
      {
        kind: 'competency',
        competency: 'failure_modes',
        levelMet: null,
        rationale: 'Claims the candidate described idempotent completion.',
        confidence: 0.9,
        quotes: ['we used an idempotency key on completion'],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port)))

  expect(result.findings).toHaveLength(1)
  expect(result.findings[0]?.rationale).toBe('Lease-based recovery is described end to end.')
  expect(result.dropped).toHaveLength(1)
  expect(result.dropped[0]?.reason).toContain('unresolvable_quote')
  expect(result.dropped[0]?.rationale).toContain('idempotent completion')
  everyCitationResolves(result)
})

test('the dropped finding leaves no span or evidence behind', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'competency',
        competency: 'mechanism',
        levelMet: null,
        rationale: 'Invented.',
        confidence: 0.9,
        quotes: ['a sentence the candidate never said'],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port)))

  expect(result.findings).toHaveLength(0)
  expect(result.spans).toHaveLength(0)
  expect(result.evidence).toHaveLength(0)
})

test('an abstention is a finding with citations, not a null and not an error', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'claim_abstained',
        abstention: 'insufficient_evidence',
        rationale: 'The retry policy is referred to but never described.',
        confidence: 0.7,
        quotes: ["I don't think we handled that."],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port, { claimSpanId: 'resume-span-1' })))

  expect(result.findings).toHaveLength(1)
  const finding = result.findings[0]
  expect(finding?.kind).toBe('claim_abstained')
  expect(finding?.rubric.id).toBe('claim_status')
  everyCitationResolves(result)

  const resume = result.evidence.find((link) => link.trust === 'candidate_asserted')
  expect(resume?.target).toEqual({ kind: 'span', spanId: 'resume-span-1' })
  expect(result.evidence.some((link) => link.trust === 'transcript_observed')).toBe(true)
})

test('composure is a separate finding on a pressure turn', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'competency',
        competency: 'failure_modes',
        levelMet: 'junior',
        rationale: 'One failure mode named, no mitigation and no cost.',
        confidence: 0.75,
        quotes: ['If it dies the lease expires'],
      },
      {
        kind: 'composure',
        signals: ['holding_ground'],
        rationale: 'Held the correct position about lease ownership and gave a reason.',
        confidence: 0.6,
        quotes: ['renews it while it works'],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port, { action: 'FALSE_PREMISE' })))

  expect(result.findings.map((finding) => finding.kind)).toEqual(['competency', 'composure'])
  const composure = result.findings.find((finding) => finding.kind === 'composure')
  const correctness = result.findings.find((finding) => finding.kind === 'competency')
  expect(composure?.id).not.toBe(correctness?.id)
  expect(composure?.rubric.id).toBe('composure')
  expect(correctness?.rubric.id).toBe('failure_modes')
  // A composure judgment cites the transcript and nothing else — the résumé bears on the claim only.
  expect(result.evidence.every((link) => link.trust === 'transcript_observed')).toBe(true)
  everyCitationResolves(result)
})

test('a composure judgment on a turn that applied no pressure is dropped', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'composure',
        signals: ['folding'],
        rationale: 'Folded under a challenge that was never made.',
        confidence: 0.5,
        quotes: ['renews it while it works'],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port, { action: 'PROBE_MECHANISM' })))

  expect(result.findings).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('composure_without_pressure_action')
})

test('a claim judgment with no claim under interrogation is dropped', async () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'claim',
        verdict: 'supported',
        rationale: 'Supports a claim that was never on the table.',
        confidence: 0.9,
        quotes: ['renews it while it works'],
      },
    ],
  }
  const { port } = fakeEvaluator({ ok: true, value: output, invocation: INVOCATION })

  const result = ok(await evaluateAnswer(inputFor(port, { claim: null })))

  expect(result.findings).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('claim_finding_without_claim')
})

test('a failed port result is a failure, not an evaluation with no findings', async () => {
  const { port } = fakeEvaluator({
    ok: false,
    failure: { kind: 'refusal' },
    invocation: INVOCATION,
  })

  const result = await evaluateAnswer(inputFor(port))

  expect('failed' in result).toBe(true)
  if (!('failed' in result)) return
  expect(result.failed.kind).toBe('refusal')
  expect(result.invocation.id).toBe('invocation-1')
})

test('the request carries the versioned prompt and the level anchors the turn can judge', async () => {
  const { port, requests } = fakeEvaluator({
    ok: true,
    value: { findings: [] },
    invocation: INVOCATION,
  })

  await evaluateAnswer(inputFor(port, { action: 'PROBE_MECHANISM' }))

  const request = requests[0]
  expect(request?.promptId).toBe('answer-evaluation')
  expect(request?.promptVersion).toBe(1)
  expect(request?.promptHash).toHaveLength(16)
  expect(request?.user).toContain('failure_modes (v1)')
  expect(request?.user).toContain('claim_status (v1)')
  // Not a pressure turn, so the composure bar is not put in front of the model at all.
  expect(request?.user).not.toContain('composure (v1)')
  expect(request?.user).toContain('UNTRUSTED_ANSWER')
})

test('the fixtures the fake port returns satisfy the schema the model is held to', () => {
  const output: EvaluationOutput = {
    findings: [
      {
        kind: 'claim',
        verdict: 'partially_supported',
        rationale: 'Recovery described, double completion not.',
        confidence: 0.8,
        quotes: ['If it dies the lease expires'],
      },
    ],
  }
  expect(Value.Check(EvaluationOutputSchema, output)).toBe(true)
  expect(Value.Check(EvaluationOutputSchema, { findings: [{ kind: 'claim' }] })).toBe(false)
})
