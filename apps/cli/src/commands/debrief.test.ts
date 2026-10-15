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

function sessionOf(id: string): Session {
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
    startedAt: '2026-09-20T09:00:00.000Z',
  }
}

async function seedSessionWithProsody(eventDir: string, id: string): Promise<void> {
  const store = new JsonlEventStore(eventDir, LOCAL_OWNER_ID)
  const log = await SessionLog.open({ store, clock: new FixedClock(), ids: new SeqIds() }, id)
  await log.append('state_change', { change: 'session_started', session: sessionOf(id) })
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

test('debrief prints both lanes and the performance-lane closing that says the numbers judge nothing', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-debrief-'))
  try {
    await seedSessionWithProsody(eventDir, 'ses_debrief1')
    const result = await levelhead(['debrief', '--session', 'ses_debrief1'], eventDir)

    expect(result.code).toBe(0)
    expect(result.out).toContain('DEBRIEF · session ses_debrief1')
    expect(result.out).toContain('WHAT YOU KNOW · judged against the rubric, with the evidence')
    expect(result.out).toContain('HOW YOU CAME ACROSS · measured from the recording, never judged')
    expect(result.out).toContain('Signals measured this session')
    // The line that travels with every performance-lane render.
    expect(result.out).toContain('any answer was any good')
    // Only one session on record, so the command names the missing baseline honestly.
    expect(result.out).toContain('only session on record')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)

test('debrief reports an unknown session rather than an empty report', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-debrief-'))
  try {
    const result = await levelhead(['debrief', '--session', 'ses_missing'], eventDir)
    expect(result.code).toBe(1)
    expect(result.out).toContain('no such session: ses_missing')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)

test('debrief without a session prints usage and fails', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-debrief-'))
  try {
    const result = await levelhead(['debrief'], eventDir)
    expect(result.code).toBe(1)
    expect(result.out).toContain('levelhead debrief --session <id>')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)
