import { describe, expect, test } from 'bun:test'
import type { ArmMetrics, GateResult, Interval } from './contract.ts'
import {
  FLAGSHIP_AGREEMENT_MIN_N,
  agreementAssertability,
  humanRatingsMatrix,
  LabelIndex,
} from './labels.ts'
import { THRESHOLDS, evaluateGates, stopConditions, type GateInput } from './gates.ts'

function metrics(over: Partial<ArmMetrics> = {}): ArmMetrics {
  return {
    claimExtraction: { precision: 1, recall: 1, f1: 1, tp: 4, fp: 0, fn: 0 },
    gapsPerQuestion: 0.5,
    gapsPerQuestionInterval: { point: 0.5, lower: 0.4, upper: 0.6, resamples: 2000 },
    gapsFound: 4,
    questionsAsked: 8,
    evidenceLinkPrecision: 0.9,
    evidenceLinkPrecisionInterval: { point: 0.9, lower: 0.8, upper: 0.95, resamples: 2000 },
    evidenceLinksEmitted: 10,
    evidenceLinksUnresolvable: 0,
    injectionSuccessRate: 0,
    injectionAttempts: 6,
    abstentionRate: 0.2,
    abstentionRateOnInsufficientEvidence: 0.8,
    usage: { calls: 10, inputTokens: 1000, outputTokens: 200, costUsd: 0.1 },
    ...over,
  }
}

function interval(lower: number, upper: number): Interval {
  return { point: (lower + upper) / 2, lower, upper, resamples: 2000 }
}

// Two labellers: a single labeller agrees with themselves, and the gate says so.
function labelsOfSize(n: number): LabelIndex {
  return new LabelIndex(
    Array.from({ length: n }, (_, at) => at).flatMap((at) =>
      ['ann', 'bob'].map((labeller) => ({
        kind: 'claim_verdict' as const,
        itemId: `item-${at}`,
        verdict: 'supported' as const,
        labeller,
        labelledAt: '2026-09-09',
        note: '',
      })),
    ),
  )
}

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    bar: 'flagship',
    syntheticFixtures: false,
    underTest: { armId: 'levelhead_full', metrics: metrics() },
    baselines: [
      {
        armId: 'fixed_sequence',
        metrics: metrics({ gapsPerQuestion: 0.2, gapsPerQuestionInterval: interval(0.1, 0.3) }),
      },
    ],
    ablation: {
      armId: 'levelhead_no_adaptation',
      metrics: metrics({ gapsPerQuestion: 0.2, gapsPerQuestionInterval: interval(0.1, 0.3) }),
    },
    repoRag: {
      armId: 'repo_rag',
      metrics: metrics({ evidenceLinkPrecisionInterval: interval(0.2, 0.4) }),
    },
    agreement: {
      modelHuman: interval(0.65, 0.8),
      humanHuman: interval(0.7, 0.85),
      assertability: agreementAssertability(
        humanRatingsMatrix(labelsOfSize(FLAGSHIP_AGREEMENT_MIN_N)),
      ),
    },
    calibration: { reliability: 0.02, resolution: 0.1 },
    abstention: { aurc: 0.1, baselines: [{ armId: 'fixed_sequence', aurc: 0.3 }] },
    repeatedRunVariance: 0.01,
    invariants: [{ id: 'span_validity', met: true, relaxed: false, detail: '1.00' }],
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    ...over,
  }
}

function gate(results: readonly GateResult[], id: string): GateResult {
  const found = results.find((one) => one.id === id)
  if (found === undefined) throw new Error(`no gate ${id}`)
  return found
}

describe('the n < 100 rule', () => {
  test('agreement is unknown below the pre-declared minimum, never a pass', () => {
    const small = humanRatingsMatrix(labelsOfSize(FLAGSHIP_AGREEMENT_MIN_N - 1))
    const report = evaluateGates(
      input({
        agreement: {
          // A point estimate and an interval that would sail past the bar. Neither may be asserted.
          modelHuman: interval(0.9, 0.99),
          humanHuman: interval(0.9, 0.99),
          assertability: agreementAssertability(small),
        },
      }),
    )
    const agreement = gate(report.results, 'agreement_alpha')
    expect(agreement.status).toBe('unknown')
    expect(agreement.reason).toContain(String(FLAGSHIP_AGREEMENT_MIN_N))
    expect(report.claimsPermitted).toBe(false)
  })

  test('alpha is still computed and published below the minimum; only the pass or fail is withheld', () => {
    const small = agreementAssertability(humanRatingsMatrix(labelsOfSize(30)))
    expect(small.assertable).toBe(false)
    expect(small.n).toBe(30)
    expect(small.reason).toContain('no pass or fail is asserted')
  })
})

describe('a gate that cannot run has not been passed', () => {
  test('a missing baseline makes gaps per question unknown', () => {
    const report = evaluateGates(input({ baselines: [] }))
    expect(gate(report.results, 'gaps_per_question').status).toBe('unknown')
  })

  test('an arm never shown an injection is unknown, not clean', () => {
    const report = evaluateGates(
      input({
        underTest: { armId: 'levelhead_full', metrics: metrics({ injectionSuccessRate: null }) },
      }),
    )
    expect(gate(report.results, 'injection_success_rate').status).toBe('unknown')
  })

  test('no invariant results makes the invariant gate unknown', () => {
    expect(
      gate(evaluateGates(input({ invariants: [] })).results, 'structural_invariants').status,
    ).toBe('unknown')
  })

  test('one run cannot report repeated-run variance', () => {
    const report = evaluateGates(input({ repeatedRunVariance: null }))
    expect(gate(report.results, 'repeated_run_variance').status).toBe('unknown')
  })
})

describe('the flagship gate reads the lower bound, never the point estimate', () => {
  test('a high point estimate with a lower bound under the bar fails', () => {
    const report = evaluateGates(
      input({
        agreement: {
          modelHuman: {
            point: 0.95,
            lower: THRESHOLDS.agreementAlphaLowerBound.flagship - 0.01,
            upper: 0.99,
            resamples: 2000,
          },
          humanHuman: interval(0.7, 0.85),
          assertability: agreementAssertability(
            humanRatingsMatrix(labelsOfSize(FLAGSHIP_AGREEMENT_MIN_N)),
          ),
        },
      }),
    )
    expect(gate(report.results, 'agreement_alpha').status).toBe('fail')
  })

  test('model-human alpha without human-human alpha is unknown at the flagship bar', () => {
    const report = evaluateGates(
      input({
        agreement: {
          modelHuman: interval(0.8, 0.9),
          humanHuman: null,
          assertability: agreementAssertability(
            humanRatingsMatrix(labelsOfSize(FLAGSHIP_AGREEMENT_MIN_N)),
          ),
        },
      }),
    )
    expect(gate(report.results, 'agreement_alpha').status).toBe('unknown')
  })

  test('overlapping gaps-per-question intervals fail even when the point estimate is higher', () => {
    const report = evaluateGates(
      input({
        baselines: [
          {
            armId: 'fixed_sequence',
            metrics: metrics({
              gapsPerQuestion: 0.45,
              gapsPerQuestionInterval: interval(0.3, 0.55),
            }),
          },
        ],
      }),
    )
    expect(gate(report.results, 'gaps_per_question').status).toBe('fail')
  })
})

describe('claims permitted', () => {
  test('the self-use bar never licenses publication', () => {
    const report = evaluateGates(input({ bar: 'self_use' }))
    expect(report.claimsPermitted).toBe(false)
    expect(report.claimsPermittedReason).toContain('practice, not publication')
  })

  test('a synthetic fixture set never licenses publication', () => {
    expect(evaluateGates(input({ syntheticFixtures: true })).claimsPermitted).toBe(false)
  })

  test('every flagship gate passing on a real set does license one', () => {
    const report = evaluateGates(input())
    expect(report.results.every((one) => one.status === 'pass')).toBe(true)
    expect(report.claimsPermitted).toBe(true)
  })
})

describe('the three stop conditions', () => {
  test('(a) fires when full Levelhead overlaps the no-adaptation ablation', () => {
    const fired = stopConditions(
      input({
        underTest: {
          armId: 'levelhead_full',
          metrics: metrics({ gapsPerQuestionInterval: interval(0.4, 0.6) }),
        },
        ablation: {
          armId: 'levelhead_no_adaptation',
          metrics: metrics({ gapsPerQuestionInterval: interval(0.55, 0.7) }),
        },
      }),
    )
    const a = fired.find((one) => one.id === 'a_adaptation_adds_nothing')
    expect(a?.status).toBe('fired')
    expect(a?.reason).toContain('decoration')
  })

  test('(b) fires when evidence-link precision is not separated from repository RAG', () => {
    const fired = stopConditions(
      input({
        underTest: {
          armId: 'levelhead_full',
          metrics: metrics({ evidenceLinkPrecisionInterval: interval(0.5, 0.8) }),
        },
        repoRag: {
          armId: 'repo_rag',
          metrics: metrics({ evidenceLinkPrecisionInterval: interval(0.6, 0.9) }),
        },
      }),
    )
    expect(fired.find((one) => one.id === 'b_provenance_adds_nothing')?.status).toBe('fired')
  })

  test('(c) fires when an invariant is relaxed rather than met', () => {
    const fired = stopConditions(
      input({
        invariants: [
          { id: 'span_validity', met: true, relaxed: false, detail: '1.00' },
          { id: 'injection_success', met: true, relaxed: true, detail: 'bound raised from 0 to 1' },
        ],
      }),
    )
    const c = fired.find((one) => one.id === 'c_invariant_relaxed')
    expect(c?.status).toBe('fired')
    expect(c?.reason).toContain('injection_success')
  })

  test('none fires on a run that separated on both axes and relaxed nothing', () => {
    expect(stopConditions(input()).every((one) => one.status === 'not_fired')).toBe(true)
  })

  test('a missing ablation is unknown, not a passed stop condition', () => {
    const fired = stopConditions(input({ ablation: null, repoRag: null }))
    expect(fired.find((one) => one.id === 'a_adaptation_adds_nothing')?.status).toBe('unknown')
    expect(fired.find((one) => one.id === 'b_provenance_adds_nothing')?.status).toBe('unknown')
  })
})
