import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { silentLogger } from '@levelhead/core'
import type { JobRecord, Nudge, NudgeChannel, NudgeDelivery } from '@levelhead/contracts'
import {
  DryRunOutreach,
  type OutreachPort,
  type OutreachReadiness,
} from '../../../../packages/core/src/outreach/index.ts'
import { FileNudgeLedger } from '../adapters/nudge-ledger.ts'
import { OutreachAdapters } from '../adapters/outreach.ts'
import type { HandlerContext } from './context.ts'
import { sendNudge } from './send-nudge.ts'

const AT = '2026-09-22T09:00:00.000Z'

const NUDGE: Nudge = {
  id: 'nudge_1',
  channel: 'sms',
  to: '+15550000000',
  subject: null,
  body: '1 gap from your own sessions is due.\n- Could not say why (open, not drilled yet) [gap_a]',
  dueAt: '2026-09-05T00:00:00.000Z',
  gapIds: ['gap_a'],
}

function job(dryRun: boolean): JobRecord {
  return {
    id: 'job_1',
    ownerId: 'local',
    kind: 'send_nudge',
    idempotencyKey: 'nudge:local:2026-09-22',
    payload: { kind: 'send_nudge', nudge: NUDGE, dryRun },
    state: 'leased',
    attempts: 1,
    maxAttempts: 3,
    runAfter: AT,
    leaseOwner: 'worker-1',
    leaseExpiresAt: AT,
    lastError: null,
    createdAt: AT,
    updatedAt: AT,
  }
}

class CountingOutreach implements OutreachPort {
  sends = 0
  readonly readiness: OutreachReadiness = { state: 'ready', provider: 'counting' }

  send(nudge: Nudge): Promise<NudgeDelivery> {
    this.sends += 1
    return Promise.resolve({
      nudgeId: nudge.id,
      channel: nudge.channel,
      outcome: 'sent',
      at: AT,
      providerRef: 'ref_1',
      detail: null,
    })
  }
}

async function contextIn(
  live: OutreachPort,
  armed: boolean,
): Promise<{ context: HandlerContext; ledgerDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-nudge-'))
  const adapters: Record<NudgeChannel, OutreachPort> = { email: live, sms: live, whatsapp: live }
  return {
    ledgerDir: join(root, 'nudges', 'local'),
    context: {
      config: { LEVELHEAD_EVENT_DIR: join(root, 'events') },
      clock: { now: () => AT },
      logger: silentLogger,
      outreach: new OutreachAdapters(adapters, new DryRunOutreach({ now: () => AT }), armed),
    } as unknown as HandlerContext,
  }
}

async function onlyRecord(directory: string): Promise<unknown> {
  const files = await readdir(directory)
  expect(files).toHaveLength(1)
  return JSON.parse(await readFile(join(directory, files[0] ?? ''), 'utf8'))
}

test('a dry run keeps the whole message on disk and reports that nothing was delivered', async () => {
  const live = new CountingOutreach()
  const { context, ledgerDir } = await contextIn(live, true)

  await sendNudge(job(true), context)

  expect(live.sends).toBe(0)
  expect(await onlyRecord(ledgerDir)).toEqual({
    nudgeId: 'nudge_1',
    attemptedAt: AT,
    delivery: {
      nudgeId: 'nudge_1',
      channel: 'sms',
      outcome: 'dry_run',
      at: AT,
      providerRef: null,
      detail: null,
    },
    rendered: { subject: null, body: NUDGE.body },
  })
})

// The case this exists for: the lease expired, or the worker died after the provider accepted the
// message. Either way the candidate must not get a second copy.
test('a second run under the same key sends nothing and leaves the first record alone', async () => {
  const live = new CountingOutreach()
  const { context, ledgerDir } = await contextIn(live, true)

  await sendNudge(job(false), context)
  await sendNudge(job(false), context)

  expect(live.sends).toBe(1)
  expect(await onlyRecord(ledgerDir)).toEqual({
    nudgeId: 'nudge_1',
    attemptedAt: AT,
    delivery: {
      nudgeId: 'nudge_1',
      channel: 'sms',
      outcome: 'sent',
      at: AT,
      providerRef: 'ref_1',
      detail: null,
    },
    // A message that really went out leaves no copy of its text behind; only the dry run does.
    rendered: null,
  })
})

// The worst case for a message with an effect outside the process: it left, and the worker died
// before it could write that down. The claim is already on disk, so the retry abandons it.
test('an attempt interrupted before it resolved is reported, not repeated', async () => {
  const live = new CountingOutreach()
  const { context, ledgerDir } = await contextIn(live, true)
  const ledger = new FileNudgeLedger(join(context.config.LEVELHEAD_EVENT_DIR, '..', 'nudges'))

  expect((await ledger.claim('local', 'nudge:local:2026-09-22', NUDGE, AT)).state).toBe('claimed')
  await sendNudge(job(false), context)

  expect(live.sends).toBe(0)
  expect(await onlyRecord(ledgerDir)).toEqual({
    nudgeId: 'nudge_1',
    attemptedAt: AT,
    delivery: null,
    rendered: null,
  })
})

test('an unarmed install runs the configured provider as a dry run anyway', async () => {
  const live = new CountingOutreach()
  const { context, ledgerDir } = await contextIn(live, false)

  await sendNudge(job(false), context)

  expect(live.sends).toBe(0)
  expect(await onlyRecord(ledgerDir)).toMatchObject({
    delivery: { outcome: 'dry_run', providerRef: null },
    rendered: { subject: null, body: NUDGE.body },
  })
})
