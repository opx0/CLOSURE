import { describe, expect, test } from 'bun:test'
import { rubricSetV1 } from '@closer/core'
import { FixedClock, ScriptedConductor, SeqIds } from '../../../apps/cli/src/testing/fakes.ts'
import type { ItemOutcome } from '../contract.ts'
import { routingEvaluator, syntheticFixtures } from '../testing/synthetic.ts'
import { closerArm, fixedOrderPolicy, typedPolicy } from './closer.ts'
import { closerFullArm } from './closer-full.ts'
import { closerNoAdaptationArm } from './closer-no-adaptation.ts'
import { fixedSequenceArm } from './fixed-sequence.ts'
import type { Arm, ArmContext } from './arm.ts'

const QUESTIONS = [
  'How did the lease work?',
  'What backs that?',
  'What breaks it?',
  'What did it cost you?',
]

// Shared ids or a shared clock would make the second arm's outcome depend on the first one's, and
// every comparison in this file is between two arms run alone.
function context(): ArmContext {
  return {
    conductor: new ScriptedConductor(QUESTIONS),
    evaluator: routingEvaluator(),
    clock: new FixedClock(),
    ids: new SeqIds(),
    level: 'mid',
    mode: 'coach',
    personaId: 'skeptic',
    rubricSet: rubricSetV1,
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    maxTurns: 4,
  }
}

async function run(arm: Arm): Promise<ItemOutcome> {
  const fixtures = syntheticFixtures()
  const item = fixtures.items[0]
  const resume = fixtures.resumes[0]
  if (item === undefined || resume === undefined) throw new Error('the synthetic fixture is empty')
  return arm.interrogate(item, resume, context())
}

// `armId` is the label, not the behaviour — normalising it away leaves exactly what the two arms are
// compared on, so a difference anywhere else fails the comparison.
function behaviour(outcome: ItemOutcome): ItemOutcome {
  return { ...outcome, armId: 'closer_full' }
}

describe('the two CLOSER arms differ only by the policy', () => {
  test('rebuilding the ablation with the typed policy reproduces full CLOSER exactly', async () => {
    const rebuilt = closerArm(
      closerNoAdaptationArm.id,
      closerNoAdaptationArm.description,
      typedPolicy,
    )
    expect(behaviour(await run(rebuilt))).toEqual(behaviour(await run(closerFullArm)))
  })

  test('rebuilding full CLOSER with the fixed order reproduces the ablation exactly', async () => {
    const rebuilt = closerArm(closerFullArm.id, closerFullArm.description, fixedOrderPolicy)
    expect(behaviour(await run(rebuilt))).toEqual(behaviour(await run(closerNoAdaptationArm)))
  })

  test('and the policy actually changes the questions, or the ablation would test nothing', async () => {
    const full = await run(closerFullArm)
    const ablated = await run(closerNoAdaptationArm)
    expect(full.actions).not.toEqual(ablated.actions)
    expect(full.questionsAsked).toBe(ablated.questionsAsked)
  })
})

describe('every arm publishes the same shape', () => {
  test('an arm records its transcript, its citations and its invocations', async () => {
    const outcome = await run(closerFullArm)
    expect(outcome.transcript.length).toBe(4)
    expect(outcome.transcript[0]?.role).toBe('interviewer')
    expect(outcome.questionsAsked).toBe(2)
    expect(outcome.findings.length).toBeGreaterThan(0)
    expect(outcome.evidenceLinks.length).toBeGreaterThan(0)
    // Conductor call + evaluator call, per turn.
    expect(outcome.invocations.length).toBe(4)
    expect(outcome.failure).toBeNull()
  })

  test('CLOSER resolves every citation it keeps', async () => {
    const outcome = await run(closerFullArm)
    expect(outcome.evidenceLinks.every((link) => link.resolves)).toBe(true)
  })

  test('the fixed-sequence floor asks without a rendering call', async () => {
    const outcome = await run(fixedSequenceArm)
    expect(outcome.questionsAsked).toBe(2)
    // One evaluator call per turn and nothing else — the floor never pays a conductor.
    expect(outcome.invocations.length).toBe(2)
    expect(fixedSequenceArm.extract).toBeNull()
  })

  test('the seeded canary is only reported when it actually appears', async () => {
    const outcome = await run(closerFullArm)
    expect(outcome.injection).toBeNull()
  })
})

describe('extraction discipline', () => {
  test('CLOSER drops a claim whose quote is not in the resume; the count shows it', async () => {
    const fixtures = syntheticFixtures()
    const resume = fixtures.resumes[0]
    if (resume === undefined) throw new Error('the synthetic fixture is empty')
    const extract = closerFullArm.extract
    if (extract === null) throw new Error('full CLOSER extracts claims')

    const outcome = await extract(resume, context())
    // The script proposes two claims; one isn't in the resume verbatim.
    expect(outcome.claims.length).toBe(1)
    expect(outcome.claims.every((claim) => claim.spanResolved)).toBe(true)
    expect(outcome.failure).toBeNull()
  })
})
