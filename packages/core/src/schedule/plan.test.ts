import { expect, test } from 'bun:test'
import type { GapEntry } from '@closer/contracts'
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

test('the suggested rounds follow the competencies that are actually open', () => {
  const mechanismOnly = planNextSession({
    gaps: [gap('a')],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(mechanismOnly.suggestedRounds).toEqual(['project_deep_dive'])

  const wider = planNextSession({
    gaps: [
      gap('a'),
      gap('b', { competency: 'failure_modes' }),
      gap('c', { competency: 'composure' }),
    ],
    now: NOW,
    horizonDays: 7,
    retrievalLimit: 3,
  })
  expect(wider.suggestedRounds).toEqual(['project_deep_dive', 'design_extension', 'behavioral'])
})
