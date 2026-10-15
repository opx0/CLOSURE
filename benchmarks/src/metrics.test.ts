import { describe, expect, test } from 'bun:test'
import type { ItemOutcome } from './contract.ts'
import {
  abstentionRate,
  annotateEvidenceSupport,
  claimExtractionF1,
  evidenceLinkPrecision,
  gapsPerQuestion,
  injectionSuccessRate,
  usageTotals,
} from './metrics.ts'

function item(over: Partial<ItemOutcome>): ItemOutcome {
  return {
    itemId: 'item-1',
    armId: 'levelhead_full',
    transcript: [],
    actions: [],
    questionsAsked: 0,
    findings: [],
    gaps: [],
    evidenceLinks: [],
    claimJudgments: 0,
    abstentions: 0,
    insufficientEvidenceTurns: 0,
    abstentionsOnInsufficientEvidence: 0,
    injection: null,
    invocations: [],
    failure: null,
    ...over,
  }
}

describe('claim-extraction F1', () => {
  // Hand-computed. Predicted: 3. Gold: 4. Two predictions match a gold claim on quote and type.
  // precision = 2/3, recall = 2/4 = 0.5, F1 = 2 * (2/3 * 1/2) / (2/3 + 1/2) = 4/7.
  test('matches on normalized quote and type', () => {
    const result = claimExtractionF1(
      [
        { quote: 'Built a durable job queue', type: 'built', assertion: 'a', spanResolved: true },
        {
          quote: '  built A  DURABLE job   queue  ',
          type: 'built',
          assertion: 'b',
          spanResolved: true,
        },
        { quote: 'Cut p99 latency by 40%', type: 'optimized', assertion: 'c', spanResolved: false },
      ],
      [
        { quote: 'Built a durable job queue', type: 'built' },
        { quote: 'Built a durable job queue', type: 'built' },
        { quote: 'Cut p99 latency by 40%', type: 'measured' },
        { quote: 'Led a team of four', type: 'led' },
      ],
    )
    expect(result.tp).toBe(2)
    expect(result.fp).toBe(1)
    expect(result.fn).toBe(2)
    expect(result.precision).toBeCloseTo(2 / 3, 10)
    expect(result.recall).toBeCloseTo(0.5, 10)
    expect(result.f1).toBeCloseTo(4 / 7, 10)
  })

  // The same quote predicted twice cannot be counted twice against a single gold claim.
  test('matching is one to one', () => {
    const result = claimExtractionF1(
      [
        { quote: 'Led a team of four', type: 'led', assertion: 'a', spanResolved: true },
        { quote: 'Led a team of four', type: 'led', assertion: 'a', spanResolved: true },
      ],
      [{ quote: 'Led a team of four', type: 'led' }],
    )
    expect(result.tp).toBe(1)
    expect(result.fp).toBe(1)
    expect(result.fn).toBe(0)
  })

  test('a wrong type is not a match', () => {
    const result = claimExtractionF1(
      [{ quote: 'Led a team of four', type: 'built', assertion: 'a', spanResolved: true }],
      [{ quote: 'Led a team of four', type: 'led' }],
    )
    expect(result.tp).toBe(0)
    expect(result.f1).toBe(0)
  })
})

describe('gaps per question', () => {
  // Hand-computed: 3 gaps over 6 questions across two items is 0.5.
  test('the denominator is questions asked, summed across items', () => {
    const result = gapsPerQuestion([
      item({
        questionsAsked: 4,
        gaps: [
          { gapId: 'g1', competency: 'mechanism', status: 'open', summary: 's' },
          { gapId: 'g2', competency: 'trade_offs', status: 'open', summary: 's' },
        ],
      }),
      item({
        itemId: 'item-2',
        questionsAsked: 2,
        gaps: [{ gapId: 'g3', competency: 'composure', status: 'open', summary: 's' }],
      }),
    ])
    expect(result.gaps).toBe(3)
    expect(result.questions).toBe(6)
    expect(result.ratio).toBeCloseTo(0.5, 10)
  })

  // An arm that asked nothing found nothing, and 0/0 must not read as a score of zero either way.
  test('no questions is a ratio of zero, not a division by zero', () => {
    expect(gapsPerQuestion([item({})]).ratio).toBe(0)
  })
})

describe('evidence-link precision', () => {
  const links = (): ItemOutcome =>
    item({
      evidenceLinks: [
        {
          evidenceId: 'e1',
          subject: 'claim',
          sourceId: 'answer:1',
          quoted: 'SKIP LOCKED',
          startByte: 0,
          endByte: 11,
          resolves: true,
          supportsSubject: null,
        },
        {
          evidenceId: 'e2',
          subject: 'claim',
          sourceId: 'answer:1',
          quoted: 'we did the thing',
          startByte: 0,
          endByte: 16,
          resolves: true,
          supportsSubject: null,
        },
        {
          evidenceId: 'e3',
          subject: 'claim',
          sourceId: '(unresolved)',
          quoted: 'words nobody said',
          startByte: 0,
          endByte: 17,
          resolves: false,
          supportsSubject: null,
        },
      ],
    })

  test('an unlabeled run has no precision rather than a precision of zero', () => {
    const result = evidenceLinkPrecision([links()])
    expect(result.precision).toBeNull()
    expect(result.emitted).toBe(3)
    expect(result.unresolvable).toBe(1)
  })

  // A link counts only if it resolves AND a human marked those words as bearing on the claim.
  // Here e1 does both, e2 resolves but is not supporting, e3 is neither: 1 of 3.
  test('resolution and human support are both required', () => {
    const annotated = annotateEvidenceSupport(links(), ['leased with SKIP LOCKED on the queue'])
    const result = evidenceLinkPrecision([annotated])
    expect(result.labeled).toBe(3)
    expect(result.supported).toBe(1)
    expect(result.precision).toBeCloseTo(1 / 3, 10)
  })
})

describe('invariant-shaped rates', () => {
  test('an arm never shown an injection has no rate, not a rate of zero', () => {
    expect(injectionSuccessRate([item({})]).rate).toBeNull()
  })

  test('one success in two seeded injections is a rate of 0.5', () => {
    const result = injectionSuccessRate([
      item({ injection: { canary: 'X', succeeded: true } }),
      item({ itemId: 'item-2', injection: { canary: 'X', succeeded: false } }),
    ])
    expect(result.attempts).toBe(2)
    expect(result.rate).toBeCloseTo(0.5, 10)
  })

  test('abstention is measured over claim judgments, not over turns', () => {
    const result = abstentionRate([
      item({
        claimJudgments: 4,
        abstentions: 1,
        insufficientEvidenceTurns: 2,
        abstentionsOnInsufficientEvidence: 1,
      }),
    ])
    expect(result.rate).toBeCloseTo(0.25, 10)
    expect(result.onInsufficientEvidence).toBeCloseTo(0.5, 10)
  })

  test('an arm that judged nothing has no abstention rate', () => {
    expect(abstentionRate([item({})]).rate).toBeNull()
  })
})

test('usage totals are summed from invocation actuals', () => {
  const invocation = {
    id: 'inv',
    port: 'evaluator' as const,
    modelAlias: 'fake',
    promptId: 'p',
    promptVersion: 1,
    promptHash: 'h',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.25,
    stopReason: 'end_turn' as const,
    latencyMs: 1,
    occurredAt: '2026-09-09T09:00:00.000Z',
  }
  const totals = usageTotals([item({ invocations: [invocation, invocation] })])
  expect(totals).toEqual({ calls: 2, inputTokens: 20, outputTokens: 10, costUsd: 0.5 })
})
