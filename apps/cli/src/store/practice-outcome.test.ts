import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GapEntry, PracticeOutcome, Topic } from '@levelhead/contracts'
import { LOCAL_OWNER_ID } from '@levelhead/contracts'
import {
  applyPracticeOutcome,
  PracticeOutcomeError,
  replay,
  reviewDueAt,
  runSession,
  SessionLog,
  type SessionIo,
} from '@levelhead/core'
import { SeqIds, ScriptedConductor, ScriptedEvaluator } from '../testing/fakes.ts'
import { JsonlEventStore } from './jsonl.ts'

const AT = '2026-10-13T12:00:00.000Z'
const ANSWER = 'I would break circular wait by ordering the locks. I am not sure what happens next.'
const QUOTE = 'break circular wait by ordering the locks'

function gapOf(over: Partial<GapEntry> = {}): GapEntry {
  return {
    id: 'gap-1',
    competency: 'mechanism',
    topicId: 'os.deadlock',
    summary: 'Cannot explain deadlock.',
    status: 'closed_under_transfer',
    findingIds: ['finding-original'],
    evidenceIds: [],
    openedAt: '2026-09-01T09:00:00.000Z',
    lastTouchedAt: '2026-09-02T09:00:00.000Z',
    transferAttemptIds: ['transfer-original'],
    ...over,
  }
}

function topic(id: string): Topic {
  return {
    id,
    area: 'os',
    title: id,
    ask: `Explain ${id}`,
    minLevel: 'junior',
    expected: { mechanism: ['locking'], trade_offs: ['contention'], failure_modes: ['deadlock'] },
    falsePremise: 'Deadlock cannot happen.',
    twist: 'The locks now span two machines.',
  }
}

function judgment(result: 'held' | 'failed' | 'abstained') {
  return {
    findings: [
      result === 'abstained'
        ? {
            kind: 'competency_abstained',
            competency: 'mechanism',
            abstention: 'insufficient_evidence',
            rationale: 'Not enough explanation to judge.',
            confidence: 0.6,
            quotes: [QUOTE],
          }
        : {
            kind: 'competency',
            competency: 'mechanism',
            levelMet: result === 'held' ? 'junior' : null,
            rationale:
              result === 'held' ? 'Explained the lock ordering.' : 'Did not explain the cycle.',
            confidence: 0.8,
            quotes: [QUOTE],
          },
    ],
  }
}

async function withStore(run: (store: JsonlEventStore, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-practice-'))
  try {
    await run(new JsonlEventStore(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function practice(
  store: JsonlEventStore,
  kind: PracticeOutcome['kind'],
  result: 'held' | 'failed' | 'abstained',
  carried = gapOf(),
  at = AT,
) {
  const io: SessionIo = {
    round() {},
    question() {},
    async answer() {
      return ANSWER
    },
    findings() {},
    async confirmRetry() {
      return false
    },
    notice() {},
  }
  const scripted =
    kind === 'drill'
      ? [judgment('failed'), judgment(result)]
      : kind === 'retrieval'
        ? [judgment('held'), judgment('held'), judgment(result)]
        : [judgment(result)]
  return runSession({
    claims: [],
    topics: kind === 'transfer' ? [topic('os.deadlock')] : [topic('os.a'), topic('os.b')],
    mode: kind === 'transfer' ? 'transfer' : 'simulation',
    level: 'junior',
    personaId: 'collaborator',
    pressureCeiling: 1,
    rounds: ['cs_fundamentals'],
    turnsPerRound: kind === 'retrieval' ? 3 : 1,
    drill: kind === 'drill',
    ...(kind === 'retrieval' ? { retrievals: [carried] } : {}),
    ...(kind === 'transfer' ? { transferGap: carried } : {}),
    ceilings: { sessionCostUsd: 5, sessionTokens: 1000000, modelCallsPerTurn: 3 },
    deps: {
      store,
      clock: { now: () => at },
      ids: new SeqIds(),
      conductor: new ScriptedConductor([
        'Explain locking.',
        'Explain the cycle.',
        'What breaks it?',
      ]),
      evaluator: new ScriptedEvaluator(scripted),
      io,
    },
  })
}

test('complete practice outcomes survive real JSONL reread, including failures and abstentions', async () => {
  for (const kind of ['drill', 'transfer', 'retrieval'] as const) {
    for (const verdict of ['held', 'failed', 'abstained'] as const) {
      await withStore(async (store, dir) => {
        const result = await practice(
          store,
          kind,
          verdict,
          gapOf({ status: kind === 'transfer' ? 'drilled' : 'closed_under_transfer' }),
        )
        const events = await new JsonlEventStore(dir).read(result.sessionId)
        const recorded = events.find(
          (event) => event.kind === 'state_change' && event.payload.change === 'practice_outcome',
        )
        if (recorded?.kind !== 'state_change' || recorded.payload.change !== 'practice_outcome') {
          throw new Error('practice outcome was not recorded')
        }
        const { gapId, attemptId } = recorded.payload
        const gap = replay(events).gaps.get(gapId)
        expect(gap?.practiceReceipts).toEqual([{ attemptId, kind, held: verdict === 'held' }])
        expect(gap?.lastTouchedAt).toBe(AT)
        const expectedStatus =
          kind === 'drill'
            ? verdict === 'held'
              ? 'drilled'
              : 'open'
            : verdict === 'held'
              ? 'closed_under_transfer'
              : 'open'
        expect(gap?.status).toBe(expectedStatus)
        expect(recorded.occurredAt).toBe(AT)
        if (kind === 'retrieval') {
          expect(gap?.retrievals).toEqual([{ attemptId, at: AT, passed: verdict === 'held' }])
          expect(gap?.transferAttemptIds).toEqual(['transfer-original'])
          if (gap !== undefined && verdict === 'held')
            expect(reviewDueAt(gap)).toBe('2026-10-16T12:00:00.000Z')
        }
        if (kind === 'transfer')
          expect(gap?.transferAttemptIds).toEqual(['transfer-original', attemptId])
        if (kind === 'drill') expect(gap?.transferAttemptIds).toEqual([])
      })
    }
  }
})

test('live duplicate admission retains carried history and conflicts never append an outcome', async () => {
  const carried = gapOf({
    lastTouchedAt: AT,
    practiceReceipts: [{ attemptId: 'att_0005', kind: 'retrieval', held: true }],
    retrievals: [{ attemptId: 'att_0005', at: AT, passed: true }],
  })
  await withStore(async (store, dir) => {
    const result = await practice(store, 'retrieval', 'held', carried, '2026-11-01T12:00:00.000Z')
    const events = await new JsonlEventStore(dir).read(result.sessionId)
    expect(
      events.filter(
        (event) => event.kind === 'state_change' && event.payload.change === 'practice_outcome',
      ),
    ).toEqual([])
    expect(replay(events).gaps.get(carried.id)).toEqual(carried)
  })
  await withStore(async (store, dir) => {
    const rejected = await practice(store, 'retrieval', 'failed', carried)
    expect(rejected.stoppedBy).toBe('practice_outcome_rejected')
    if (rejected.stoppedBy === 'practice_outcome_rejected')
      expect(rejected.failure.kind).toBe('attempt_conflict')
    const events = await new JsonlEventStore(dir).read('ses_0001')
    expect(
      events.filter(
        (event) => event.kind === 'state_change' && event.payload.change === 'practice_outcome',
      ),
    ).toEqual([])
    expect(replay(events).gaps.get(carried.id)).toEqual(carried)
  })
})

test('recorded event time is the live and replay anchor, and carry keeps duplicate receipts', async () => {
  await withStore(async (store, dir) => {
    let tick = 0
    const clock = { now: () => new Date(Date.parse(AT) + tick++ * 1000).toISOString() }
    const log = await SessionLog.open({ store, clock, ids: new SeqIds() }, 'practice')
    const before = gapOf()
    await log.append('state_change', { change: 'gap_opened', gap: before })
    const outcome: PracticeOutcome = {
      gapId: before.id,
      attemptId: 'new-retrieval',
      kind: 'retrieval',
      held: true,
    }
    const event = await log.append('state_change', { change: 'practice_outcome', ...outcome })
    const live = applyPracticeOutcome({
      gap: before,
      outcome: { ...outcome, occurredAt: event.occurredAt },
    })
    if (live.kind !== 'applied') throw new Error('outcome was not applied')
    expect(live.gap.lastTouchedAt).toBe('2026-10-13T12:00:01.000Z')
    expect(reviewDueAt(live.gap)).toBe('2026-10-16T12:00:01.000Z')
    const reread = replay(await new JsonlEventStore(dir).read('practice')).gaps.get(before.id)
    expect(reread).toEqual(live.gap)
    const next = await SessionLog.open({ store, clock, ids: new SeqIds() }, 'carry')
    await next.append('state_change', { change: 'gap_opened', gap: live.gap })
    await next.append('state_change', { change: 'practice_outcome', ...outcome })
    expect(replay(await new JsonlEventStore(dir).read('carry')).gaps.get(before.id)).toEqual(
      live.gap,
    )
    await next.append('state_change', { change: 'practice_outcome', ...outcome, held: false })
    expect(() => replay(next.events())).toThrow(PracticeOutcomeError)
  })
})

test('reading legacy gap-status events preserves bytes and does not invent practice history', async () => {
  await withStore(async (store, dir) => {
    const log = await SessionLog.open(
      { store, clock: { now: () => AT }, ids: new SeqIds() },
      'legacy',
    )
    await log.append('state_change', { change: 'gap_opened', gap: gapOf({ status: 'drilled' }) })
    await log.append('state_change', {
      change: 'gap_status',
      gapId: 'gap-1',
      from: 'drilled',
      to: 'closed_under_transfer',
      attemptId: 'old-transfer',
    })
    const file = join(dir, LOCAL_OWNER_ID, 'legacy.jsonl')
    const bytes = await readFile(file, 'utf8')
    const gap = replay(await new JsonlEventStore(dir).read('legacy')).gaps.get('gap-1')
    expect(gap?.transferAttemptIds).toEqual(['transfer-original', 'old-transfer'])
    expect(gap?.practiceReceipts).toBeUndefined()
    expect(gap?.retrievals).toBeUndefined()
    expect(gap?.lastTouchedAt).toBe(AT)
    expect(await readFile(file, 'utf8')).toBe(bytes)
  })
})
