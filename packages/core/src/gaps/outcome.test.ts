import { expect, test } from 'bun:test'
import type { GapEntry, PracticeOutcome } from '@levelhead/contracts'
import { applyPracticeOutcome, type PracticeOutcomeResult } from './outcome.ts'
import { isDue, reviewDueAt } from '../schedule/due.ts'

const AT = '2026-09-05T00:00:00.000Z'

function gapOf(over: Partial<GapEntry> = {}): GapEntry {
  return {
    id: 'gap-1',
    competency: 'failure_modes',
    claimId: 'claim-1',
    summary: 'Double completion after worker resurrection',
    status: 'open',
    findingIds: ['finding-1'],
    evidenceIds: ['evidence-1'],
    openedAt: '2026-08-01T00:00:00.000Z',
    lastTouchedAt: '2026-09-01T00:00:00.000Z',
    transferAttemptIds: [],
    ...over,
  }
}

function outcome(kind: PracticeOutcome['kind'], held: boolean, attemptId = 'attempt-1') {
  return { gapId: 'gap-1', attemptId, kind, held, occurredAt: AT }
}

function applied(result: PracticeOutcomeResult): GapEntry {
  if (result.kind !== 'applied') throw new Error(`expected applied, got ${result.kind}`)
  return result.gap
}

test('Drill records success or failure and touches the gap without ever closing it', () => {
  for (const held of [true, false]) {
    const gap = applied(applyPracticeOutcome({ gap: gapOf(), outcome: outcome('drill', held) }))
    expect(gap.status).toBe(held ? 'drilled' : 'open')
    expect(gap.lastTouchedAt).toBe(AT)
    expect(gap.transferAttemptIds).toEqual([])
    expect(gap.retrievals).toBeUndefined()
    expect(gap.practiceReceipts).toEqual([{ attemptId: 'attempt-1', kind: 'drill', held }])
  }
})

test('Transfer keeps failed attempts as well as the successful attempt that closes the gap', () => {
  const failed = applied(
    applyPracticeOutcome({
      gap: gapOf({ status: 'drilled' }),
      outcome: outcome('transfer', false),
    }),
  )
  expect(failed.status).toBe('open')
  expect(failed.lastTouchedAt).toBe(AT)
  const passed = applied(
    applyPracticeOutcome({ gap: failed, outcome: outcome('transfer', true, 'attempt-2') }),
  )
  expect(passed.status).toBe('closed_under_transfer')
  expect(passed.transferAttemptIds).toEqual(['attempt-1', 'attempt-2'])
  expect(passed.practiceReceipts).toEqual([
    { attemptId: 'attempt-1', kind: 'transfer', held: false },
    { attemptId: 'attempt-2', kind: 'transfer', held: true },
  ])
})

test('successful Retrieval stays distinct from Transfer and widens the next interval', () => {
  const before = gapOf({ status: 'closed_under_transfer', transferAttemptIds: ['transfer-1'] })
  const gap = applied(applyPracticeOutcome({ gap: before, outcome: outcome('retrieval', true) }))
  expect(gap.status).toBe('closed_under_transfer')
  expect(gap.transferAttemptIds).toEqual(['transfer-1'])
  expect(gap.retrievals).toEqual([{ attemptId: 'attempt-1', at: AT, passed: true }])
  expect(reviewDueAt(gap)).toBe('2026-09-08T00:00:00.000Z')
  expect(before.retrievals).toBeUndefined()
})

test('failed Retrieval reopens the gap, and its repeat remains a no-op after reopening', () => {
  const first = applied(
    applyPracticeOutcome({
      gap: gapOf({ status: 'closed_under_transfer', transferAttemptIds: ['transfer-1'] }),
      outcome: outcome('retrieval', false),
    }),
  )
  expect(first.status).toBe('open')
  expect(first.retrievals).toEqual([{ attemptId: 'attempt-1', at: AT, passed: false }])
  expect(first.transferAttemptIds).toEqual(['transfer-1'])
  expect(isDue(first, '2027-01-01T00:00:00.000Z')).toBe(false)
  const repeat = applyPracticeOutcome({
    gap: first,
    outcome: { ...outcome('retrieval', false), occurredAt: '2026-10-01T00:00:00.000Z' },
  })
  expect(repeat).toEqual({ kind: 'duplicate', gap: first })
  if (repeat.kind === 'duplicate') expect(repeat.gap).toBe(first)
})

test('all practice kinds retain duplicate receipts after serialization and reject conflicting results', () => {
  for (const kind of ['drill', 'transfer', 'retrieval'] as const) {
    const original = applied(
      applyPracticeOutcome({
        gap: gapOf({ status: 'closed_under_transfer', transferAttemptIds: ['transfer-1'] }),
        outcome: outcome(kind, true),
      }),
    )
    const snapshot = structuredClone(original)
    expect(applyPracticeOutcome({ gap: snapshot, outcome: outcome(kind, true) })).toEqual({
      kind: 'duplicate',
      gap: snapshot,
    })
    expect(applyPracticeOutcome({ gap: snapshot, outcome: outcome(kind, false) })).toEqual({
      kind: 'rejected',
      failure: {
        kind: 'attempt_conflict',
        original: { attemptId: 'attempt-1', kind, held: true },
        incoming: { attemptId: 'attempt-1', kind, held: false },
      },
    })
    expect(snapshot).toEqual(original)
  }
})

test('the same attempt cannot change practice kind', () => {
  const gap = applied(applyPracticeOutcome({ gap: gapOf(), outcome: outcome('drill', true) }))
  const result = applyPracticeOutcome({ gap, outcome: outcome('transfer', true) })
  expect(result.kind).toBe('rejected')
  if (result.kind === 'rejected') expect(result.failure.kind).toBe('attempt_conflict')
  expect(gap.status).toBe('drilled')
})

test('Retrieval cannot close or practise a gap that has not held under Transfer', () => {
  for (const status of ['open', 'drilled', 'unverified'] as const) {
    expect(
      applyPracticeOutcome({ gap: gapOf({ status }), outcome: outcome('retrieval', true) }),
    ).toEqual({
      kind: 'rejected',
      failure: { kind: 'retrieval_not_closed', status },
    })
  }
})

test('legacy attempt ids remain authoritative without inventing their missing outcomes', () => {
  const gap = gapOf({ transferAttemptIds: ['attempt-1'] })
  expect(applyPracticeOutcome({ gap, outcome: outcome('transfer', true) })).toEqual({
    kind: 'rejected',
    failure: { kind: 'legacy_attempt', attemptId: 'attempt-1' },
  })
  expect(gap.practiceReceipts).toBeUndefined()
  expect(gap.status).toBe('open')
})

test('outcomes belong to their named gap and never mutate the supplied row', () => {
  const gap = gapOf()
  const before = structuredClone(gap)
  expect(
    applyPracticeOutcome({ gap, outcome: { ...outcome('drill', true), gapId: 'other' } }),
  ).toEqual({
    kind: 'rejected',
    failure: { kind: 'wrong_gap', expected: 'gap-1', received: 'other' },
  })
  applyPracticeOutcome({ gap, outcome: outcome('transfer', true) })
  expect(gap).toEqual(before)
})
