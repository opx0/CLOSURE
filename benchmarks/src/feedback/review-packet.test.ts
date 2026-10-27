import { expect, test } from 'bun:test'
import { loadFeedbackCases } from './cases.ts'
import { reviewPacket } from './review-packet.ts'

test('review packet hides reference labels and keeps held-out cases separate', async () => {
  const fixtures = await loadFeedbackCases()
  const tuning = reviewPacket(fixtures, 'tuning')
  const heldout = reviewPacket(fixtures, 'heldout')
  expect(tuning.cases.length).toBeGreaterThan(0)
  expect(heldout.cases.length).toBeGreaterThan(0)
  expect(tuning.cases.every((entry) => entry.split === 'tuning' && !('expected' in entry))).toBe(
    true,
  )
  expect(heldout.cases.every((entry) => entry.split === 'heldout' && !('expected' in entry))).toBe(
    true,
  )
  expect(
    tuning.cases.some((entry) => heldout.cases.some((other) => other.family === entry.family)),
  ).toBe(false)
  expect(tuning.disclosure).toContain('not been independently reviewed')
})
