import { expect, test } from 'bun:test'
import type { GapEntry } from '@levelhead/contracts'
import { planNextSession, type SessionPlan } from '../schedule/plan.ts'
import { renderNudge } from './render.ts'

const NOW = '2026-09-22T09:00:00.000Z'

function gap(id: string, overrides: Partial<GapEntry> = {}): GapEntry {
  return {
    id,
    competency: 'mechanism',
    summary: `summary ${id}`,
    status: 'open',
    findingIds: ['finding_1'],
    evidenceIds: [],
    openedAt: '2026-08-01T00:00:00.000Z',
    lastTouchedAt: '2026-09-05T00:00:00.000Z',
    transferAttemptIds: [],
    ...overrides,
  }
}

// The real planner, not a hand-built plan: the nudge must be unable to say anything the spaced
// retrieval schedule did not raise, and a stubbed plan would not prove that.
function planFor(gaps: GapEntry[]): SessionPlan {
  return planNextSession({ gaps, now: NOW, horizonDays: 14, retrievalLimit: 3 })
}

const LEASE = gap('gap_a', { summary: 'Could not say why the queue needed a lease' })
const RETRY = gap('gap_b', {
  summary: 'Never named a failure mode for the retry path',
  status: 'drilled',
  lastTouchedAt: '2026-09-12T00:00:00.000Z',
})

test('an SMS states what is due, why, and the gap it came from', () => {
  const nudge = renderNudge({
    plan: planFor([LEASE, RETRY]),
    channel: 'sms',
    to: '+15550000000',
    id: 'nudge_1',
    now: NOW,
  })

  expect(nudge).toEqual({
    id: 'nudge_1',
    channel: 'sms',
    to: '+15550000000',
    subject: null,
    body:
      '2 gaps from your own sessions are due.\n' +
      '- Could not say why the queue needed a lease (open, not drilled yet) [gap_a]\n' +
      '- Never named a failure mode for the retry path (drilled, not yet retested under changed constraints) [gap_b]',
    dueAt: '2026-09-05T00:00:00.000Z',
    gapIds: ['gap_a', 'gap_b'],
  })
})

test('an email carries a subject and separates its paragraphs', () => {
  const nudge = renderNudge({
    plan: planFor([LEASE]),
    channel: 'email',
    to: 'candidate@example.test',
    id: 'nudge_2',
    now: NOW,
  })

  expect(nudge).toEqual({
    id: 'nudge_2',
    channel: 'email',
    to: 'candidate@example.test',
    subject: '1 gap due in Levelhead',
    body:
      '1 gap from your own sessions is due.\n\n' +
      '- Could not say why the queue needed a lease (open, not drilled yet) [gap_a]',
    dueAt: '2026-09-05T00:00:00.000Z',
    gapIds: ['gap_a'],
  })
})

test('nothing due renders no message at all', () => {
  expect(
    renderNudge({ plan: planFor([]), channel: 'email', to: 'x@example.test', id: 'n', now: NOW }),
  ).toBeNull()
})

// A closed gap comes back as an ordinary question. Announcing it would make the retrieval a test of
// recognition instead of recall, so the schedule may raise it and the nudge still may not say it.
test('a due retrieval is never named, and on its own produces no message', () => {
  const closed = gap('gap_c', {
    status: 'closed_under_transfer',
    summary: 'Explained the lease renewal path',
    lastTouchedAt: '2026-08-01T00:00:00.000Z',
    transferAttemptIds: ['att_1'],
    retrievals: [{ attemptId: 'att_1', at: '2026-08-01T00:00:00.000Z', passed: true }],
  })

  expect(planFor([closed]).work.map((entry) => entry.reason)).toEqual(['retrieve_the_closed_gap'])
  expect(
    renderNudge({ plan: planFor([closed]), channel: 'sms', to: '+1', id: 'n', now: NOW }),
  ).toBeNull()

  const mixed = renderNudge({
    plan: planFor([closed, LEASE]),
    channel: 'sms',
    to: '+1',
    id: 'n',
    now: NOW,
  })
  expect(mixed?.gapIds).toEqual(['gap_a'])
  expect(mixed?.body).toBe(
    '1 gap from your own sessions is due.\n' +
      '- Could not say why the queue needed a lease (open, not drilled yet) [gap_a]',
  )
})

test('an SMS names the two that waited longest and says how many it left out', () => {
  const crowd = ['gap_1', 'gap_2', 'gap_3', 'gap_4'].map((id, index) =>
    gap(id, {
      summary: `summary ${id}`,
      lastTouchedAt: `2026-09-0${String(index + 1)}T00:00:00.000Z`,
    }),
  )

  expect(
    renderNudge({ plan: planFor(crowd), channel: 'sms', to: '+1', id: 'n', now: NOW })?.body,
  ).toBe(
    '4 gaps from your own sessions are due.\n' +
      '- summary gap_1 (open, not drilled yet) [gap_1]\n' +
      '- summary gap_2 (open, not drilled yet) [gap_2]\n' +
      '2 gaps not listed above.',
  )

  expect(
    renderNudge({ plan: planFor(crowd), channel: 'email', to: 'x@example.test', id: 'n', now: NOW })
      ?.gapIds,
  ).toEqual(['gap_1', 'gap_2', 'gap_3', 'gap_4'])
})

// The planner's horizon reaches past today on purpose. A nudge may only speak for the part of it
// that has actually arrived, whatever clock wrote the row.
test('a gap whose due date has not arrived yet is not called due', () => {
  const ahead = gap('gap_d', {
    summary: 'Touched by a session whose clock ran ahead of this worker',
    lastTouchedAt: '2026-09-30T00:00:00.000Z',
  })

  expect(planFor([LEASE, ahead]).work).toHaveLength(2)
  expect(
    renderNudge({
      plan: planFor([LEASE, ahead]),
      channel: 'email',
      to: 'x@example.test',
      id: 'n',
      now: NOW,
    })?.gapIds,
  ).toEqual(['gap_a'])
})
