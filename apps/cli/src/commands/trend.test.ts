import { test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLog, buildProsodyReport, type ProsodyMeasurement } from '@levelhead/core'
import { LOCAL_OWNER_ID, type Session } from '@levelhead/contracts'
import { JsonlEventStore } from '../store/jsonl.ts'
import { FixedClock, SeqIds } from '../testing/fakes.ts'

const CLI = join(import.meta.dir, '..', 'index.ts')

const MEASUREMENT: ProsodyMeasurement = {
  audioMs: 6_000,
  words: [
    { text: 'We', startMs: 500, endMs: 700 },
    { text: 'leased', startMs: 700, endMs: 1_100 },
    { text: 'each', startMs: 1_100, endMs: 1_400 },
    { text: 'job', startMs: 1_400, endMs: 1_800 },
    { text: 'for', startMs: 1_800, endMs: 2_000 },
    { text: 'thirty', startMs: 2_000, endMs: 2_400 },
    { text: 'seconds.', startMs: 2_400, endMs: 3_000 },
  ],
  sentences: [{ words: 7, endsRising: false }],
  pitch: {
    medianHz: 140,
    p10Hz: 120,
    p90Hz: 165,
    rangeSemitones: 5.5,
    coefficientOfVariation: 0.13,
  },
  intensity: { medianDb: 60, endOfTurnDropDb: -4 },
}

function sessionOf(id: string, startedAt: string): Session {
  return {
    id,
    mode: 'coach',
    level: 'senior',
    personaId: 'skeptic',
    pressureLevel: 1,
    pressureCeiling: 3,
    rubricSet: [{ id: 'claim_status', version: 1 }],
    claimIds: [],
    rounds: ['project_deep_dive'],
    startedAt,
  }
}

async function seedSession(eventDir: string, id: string, startedAt: string): Promise<void> {
  const store = new JsonlEventStore(eventDir, LOCAL_OWNER_ID)
  const log = await SessionLog.open({ store, clock: new FixedClock(), ids: new SeqIds() }, id)
  await log.append('state_change', { change: 'session_started', session: sessionOf(id, startedAt) })
  await log.append('policy_action', {
    attemptId: 'att_1',
    action: 'PROBE_MECHANISM',
    pressureLevel: 1,
    round: 'project_deep_dive',
  })
  await log.append('state_change', {
    change: 'prosody_recorded',
    report: buildProsodyReport({ attemptId: 'att_1', measurement: MEASUREMENT }),
  })
  await log.append('state_change', { change: 'session_closed', reason: 'rounds_complete' })
}

async function levelhead(
  args: readonly string[],
  eventDir: string,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, LEVELHEAD_EVENT_DIR: eventDir, LEVELHEAD_STORE: 'jsonl' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  return { code: await proc.exited, out: out + err }
}

test('trend over one session says a trend needs more than one and prints what exists', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-trend-'))
  try {
    await seedSession(eventDir, 'ses_only', '2026-09-20T09:00:00.000Z')
    const result = await levelhead(['trend'], eventDir)

    expect(result.code).toBe(0)
    expect(result.out).toContain('A trend needs more than one session')
    // What exists is still shown: the one session's ledger snapshot line.
    expect(result.out).toContain('ses_only')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)

test('trend over two sessions draws the two series apart and never merges them', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-trend-'))
  try {
    await seedSession(eventDir, 'ses_first', '2026-09-18T09:00:00.000Z')
    await seedSession(eventDir, 'ses_second', '2026-09-21T09:00:00.000Z')
    const result = await levelhead(['trend'], eventDir)

    expect(result.code).toBe(0)
    expect(result.out).toContain('how you came across, over time')
    expect(result.out).toContain('the gap ledger, session by session')
    // A real performance-trend row, proving performanceTrends ran over the recorded prosody.
    expect(result.out).toContain('tempo while actually speaking')
    // Both dated points appear on that trend.
    expect(result.out).toContain('2026-09-18')
    expect(result.out).toContain('2026-09-21')
    expect(result.out).toContain('Two series, never merged into one number')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)
