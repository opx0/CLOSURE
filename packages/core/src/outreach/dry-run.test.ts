import { afterEach, expect, test } from 'bun:test'
import type { Nudge } from '@levelhead/contracts'
import { DryRunOutreach } from './dry-run.ts'

const NUDGE: Nudge = {
  id: 'nudge_1',
  channel: 'sms',
  to: '+15550000000',
  subject: null,
  body: '1 gap from your own sessions is due.\n- Could not say why (open, not drilled yet) [gap_a]',
  dueAt: '2026-09-05T00:00:00.000Z',
  gapIds: ['gap_a'],
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('a dry run records the message and reports that nothing was delivered', async () => {
  const outreach = new DryRunOutreach({ now: () => '2026-09-22T09:00:00.000Z' })

  expect(await outreach.send(NUDGE)).toEqual({
    nudgeId: 'nudge_1',
    channel: 'sms',
    outcome: 'dry_run',
    at: '2026-09-22T09:00:00.000Z',
    providerRef: null,
    detail: null,
  })
  expect(outreach.rendered).toEqual([NUDGE])
})

// The default has to be safe even when someone has armed the wrong thing, so the assertion is that
// the request cannot happen rather than that it was not made: any call out of this process here
// fails the test with its own message.
test('a dry run opens no connection', async () => {
  globalThis.fetch = (() => {
    throw new Error('dry run reached the network')
  }) as unknown as typeof fetch

  const outreach = new DryRunOutreach({ now: () => '2026-09-22T09:00:00.000Z' })

  expect((await outreach.send(NUDGE)).outcome).toBe('dry_run')
})
