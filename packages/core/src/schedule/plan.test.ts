import { expect, test } from 'bun:test'
import type { GapEntry } from '@levelhead/contracts'
import { planNextSession } from './plan.ts'

const NOW = '2026-09-10T00:00:00.000Z'

function gap(id: string, overrides: Partial<GapEntry> = {}): GapEntry {
  return {
    id,
    competency: 'mechanism',
    summary: `gap ${id}`,
    status: 'open',
    findingIds: ['finding_1'],
    evidenceIds: [],
    openedAt: '2026-09-01T00:00:00.000Z',
    lastTouchedAt: '2026-09-01T00:00:00.000Z',
    transferAttemptIds: [],
    ...overrides,
  }
}

test('every unclosed gap is work, and each one says why', () => {
  const plan = planNextSession({
    gaps: [gap('a'), gap('b', { status: 'drilled' }), gap('c', { status: 'unverified' })],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })

  expect(plan.work.map((entry) => entry.reason)).toEqual([
    'drill_the_open_gap',
    'transfer_the_drilled_gap',
    'restate_the_unverified',
  ])
})

// A closed gap is only work again once its interval has come round; pulling one in early would
// turn spaced retrieval into ordinary repetition.
test('a closed gap enters the plan only when its review falls inside the horizon', () => {
  const closed = gap('d', {
    status: 'closed_under_transfer',
    lastTouchedAt: NOW,
    transferAttemptIds: ['att_1'],
    retrievals: [{ attemptId: 'att_1', at: NOW, passed: true }],
  })

  expect(
    planNextSession({ gaps: [closed], now: NOW, horizonDays: 1, retrievalLimit: 3 }).work,
  ).toHaveLength(0)
  expect(
    planNextSession({ gaps: [closed], now: NOW, horizonDays: 30, retrievalLimit: 3 }).work,
  ).toHaveLength(1)
})

test('a résumé gap is practised in the rounds that cross-question the résumé on that competency', () => {
  const plan = planNextSession({
    gaps: [
      gap('a', { claimId: 'claim_1' }),
      gap('b', { competency: 'failure_modes' }),
      gap('c', { competency: 'composure' }),
    ],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(plan.suggestedRounds).toEqual(['behavioral', 'project_deep_dive', 'design_extension'])

  const failureOnly = planNextSession({
    gaps: [gap('b', { competency: 'failure_modes' })],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(failureOnly.suggestedRounds).toEqual(['project_deep_dive'])
})

test('with nothing to practise, or only composure, no résumé round is suggested', () => {
  const nothing = planNextSession({ gaps: [], now: NOW, horizonDays: 7, retrievalLimit: 3 })
  expect(nothing.suggestedRounds).toEqual([])

  const composure = planNextSession({
    gaps: [gap('c', { competency: 'composure' })],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(composure.suggestedRounds).toEqual(['behavioral'])
})

test('a topic gap is practised in the round its topic is asked in', () => {
  const topicsOnly = planNextSession({
    gaps: [gap('a', { topicId: 'os.deadlock' })],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(topicsOnly.suggestedRounds).toEqual(['cs_fundamentals'])

  const mixed = planNextSession({
    gaps: [
      gap('a', { topicId: 'dsa.hash_maps', competency: 'trade_offs' }),
      gap('b', { topicId: 'os.deadlock' }),
      gap('c', { competency: 'composure' }),
    ],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(mixed.suggestedRounds).toEqual(['cs_fundamentals', 'problem_solving', 'behavioral'])
})
