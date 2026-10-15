import { test, expect } from 'bun:test'
import {
  evaluateAnswer,
  gapsFromFindings,
  indexGaps,
  rubricSetV1,
  spanViolations,
} from '@levelhead/core'
import type { Finding, GapEntry } from '@levelhead/contracts'
import { FixedClock, ScriptedConductor, ScriptedEvaluator, SeqIds } from './fakes.ts'
import { runHarnessSession } from './harness.ts'
import {
  ABSTENTION_CLAIM,
  INSUFFICIENT_EVIDENCE,
  abstained,
  abstentionRate,
  neverAbstains,
  type InsufficientEvidenceCase,
} from './insufficient-evidence.ts'

// Invariant: abstention is a first-class value that flows end to end — findings, gap status, the
// drill, and transfer — without ever being silently read as a verdict, a pass, or a closed gap. The
// rate here is a property of the scripted fixtures, not a model; the real rate is ticket 05 §5's.

const SOURCE_ID = 'answer:att_seed'

function judgeInput(seed: InsufficientEvidenceCase, evaluator: ScriptedEvaluator) {
  return {
    attemptId: 'att_seed',
    claim: ABSTENTION_CLAIM,
    claimSpanId: ABSTENTION_CLAIM.spanId,
    action: 'PROBE_MECHANISM' as const,
    round: 'project_deep_dive' as const,
    level: 'mid' as const,
    answerText: seed.answer,
    answerSourceId: SOURCE_ID,
    transcript: [{ role: 'candidate' as const, text: seed.answer }],
    rubricSet: rubricSetV1,
    evaluator,
    ids: new SeqIds(),
    clock: new FixedClock(),
  }
}

async function judgeSeeded(reply: (seed: InsufficientEvidenceCase) => unknown): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const seed of INSUFFICIENT_EVIDENCE) {
    const evaluated = await evaluateAnswer(judgeInput(seed, new ScriptedEvaluator([reply(seed)])))
    if ('failed' in evaluated)
      throw new Error(`${seed.id}: evaluator failed ${evaluated.failed.kind}`)
    // A seeded case that produced nothing is a broken fixture, not a passing test.
    expect(evaluated.findings.length).toBeGreaterThan(0)
    expect(spanViolations(evaluated.spans, new Map([[SOURCE_ID, seed.answer]]))).toEqual([])
    findings.push(...evaluated.findings)
  }
  return findings
}

test('an abstention is a first-class finding that cites what it read', async () => {
  for (const seed of INSUFFICIENT_EVIDENCE) {
    const evaluator = new ScriptedEvaluator([abstained(seed.cue, seed.why)])
    const evaluated = await evaluateAnswer(judgeInput(seed, evaluator))
    if ('failed' in evaluated) throw new Error(`${seed.id}: ${evaluated.failed.kind}`)

    const [finding] = evaluated.findings
    expect(finding?.kind).toBe('claim_abstained')
    if (finding?.kind !== 'claim_abstained') continue

    // §4.4: abstention is a value, not a null verdict — and it still has to say what it read.
    expect(finding.abstention).toBe('insufficient_evidence')
    expect(finding.transcriptSpanIds.length).toBeGreaterThan(0)
    expect(finding.evidenceIds.length).toBeGreaterThan(0)

    const quoted = finding.transcriptSpanIds.map(
      (id) => evaluated.spans.find((span) => span.id === id)?.quoted,
    )
    expect(quoted).toEqual([seed.cue])

    // The résumé link travels with it exactly as it does with a verdict.
    const trusts = finding.evidenceIds.map(
      (id) => evaluated.evidence.find((link) => link.id === id)?.trust,
    )
    expect(trusts).toContain('candidate_asserted')
    expect(trusts).toContain('transcript_observed')
  }
})

test('an abstention opens a gap at unverified, and leaves a judged one alone', async () => {
  const clockAndIds = { ids: new SeqIds(), clock: new FixedClock() }
  const findings = await judgeSeeded((seed) => abstained(seed.cue, seed.why))

  const { opened } = gapsFromFindings([findings[0]!], new Map(), clockAndIds)
  expect(opened).toHaveLength(1)
  expect(opened[0]?.status).toBe('unverified')
  expect(opened[0]?.claimId).toBe(ABSTENTION_CLAIM.id)
  // §4.6's Evidence column has to have something in it, and it comes from the finding.
  expect(opened[0]?.evidenceIds.length).toBeGreaterThan(0)

  // And it does not overwrite one that was judged: declining to judge isn't evidence against a gap.
  const alreadyOpen: GapEntry = { ...opened[0]!, status: 'open' }
  const { transitions } = gapsFromFindings([findings[1]!], indexGaps([alreadyOpen]), clockAndIds)
  expect(transitions).toEqual([])
})

test('the abstention rate over the seeded set is > 0, and the same measure reports 0 for an evaluator that never abstains', async () => {
  const abstaining = await judgeSeeded((seed) => abstained(seed.cue, seed.why))
  const rate = abstentionRate(abstaining.map((finding) => finding.kind))
  expect(rate).toBeGreaterThan(0)
  expect(rate).toBe(1)

  // Control: same function, same seeds, returns 0 when nothing declines — so > 0 above isn't a tautology.
  const stubborn = await judgeSeeded((seed) => neverAbstains(seed.cue))
  expect(abstentionRate(stubborn.map((finding) => finding.kind))).toBe(0)
  expect(stubborn.every((finding) => finding.kind === 'claim')).toBe(true)
})

test('an abstention is not a pass: it does not move a gap through a drill', async () => {
  const seed = INSUFFICIENT_EVIDENCE[0]!
  const { result } = await runHarnessSession({
    claims: [ABSTENTION_CLAIM],
    answers: [seed.answer, seed.answer],
    drill: true,
    conductor: new ScriptedConductor(['how did retries work?', 'name the backoff']),
    evaluator: new ScriptedEvaluator([
      // The turn that surfaces the gap, then a drill the evaluator declines to judge.
      {
        findings: [
          {
            kind: 'claim',
            verdict: 'unsupported_by_available_evidence',
            rationale: 'the retry policy is named, never described',
            confidence: 0.7,
            quotes: [seed.cue],
          },
        ],
      },
      abstained(seed.cue, seed.why),
    ]),
  })

  const gaps = [...result.view.gaps.values()]
  expect(gaps).toHaveLength(1)
  // Not `drilled` — "said nothing" must never read as "passed".
  expect(gaps[0]?.status).toBe('open')
})

test('an abstention is not a pass: it does not close a gap under transfer', async () => {
  const seed = INSUFFICIENT_EVIDENCE[1]!
  const carried: GapEntry = {
    id: 'gap_carried_0001',
    competency: 'mechanism',
    claimId: ABSTENTION_CLAIM.id,
    summary: 'the retry policy is named, never described',
    status: 'drilled',
    findingIds: ['finding_prior_0001'],
    evidenceIds: ['evidence_prior_0001'],
    openedAt: '2026-09-08T09:00:00.000Z',
    lastTouchedAt: '2026-09-08T09:05:00.000Z',
    transferAttemptIds: [],
    retrievals: [],
  }

  const { result } = await runHarnessSession({
    claims: [ABSTENTION_CLAIM],
    answers: [seed.answer],
    mode: 'transfer',
    transferGap: carried,
    conductor: new ScriptedConductor(['same idea, without PostgreSQL']),
    evaluator: new ScriptedEvaluator([abstained(seed.cue, seed.why)]),
  })

  const after = result.view.gaps.get(carried.id)
  expect(after).toBeDefined()
  // §4.5: a gap closes only when it *held* under changed constraints. Silence is not holding.
  expect(after?.status).not.toBe('closed_under_transfer')

  expect(after?.transferAttemptIds).toHaveLength(1)
  expect(after?.practiceReceipts?.map(({ kind, held }) => ({ kind, held }))).toEqual([
    { kind: 'transfer', held: false },
  ])
})
