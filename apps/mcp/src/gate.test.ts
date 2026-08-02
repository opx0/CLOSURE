import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentInterfaceGate } from './gate.ts'

interface Report {
  startedAt: string
  synthetic: boolean
  claimsPermitted: boolean
  gapsStatus: string
}

async function withReports(
  reports: Record<string, Report>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'closer-gate-'))
  try {
    for (const [runId, report] of Object.entries(reports)) {
      await mkdir(join(dir, runId), { recursive: true })
      await writeFile(
        join(dir, runId, 'report.json'),
        JSON.stringify({
          manifest: { runId, startedAt: report.startedAt },
          syntheticFixtureData: report.synthetic,
          gates: {
            results: [
              {
                id: 'gaps_per_question',
                status: report.gapsStatus,
                bar: 'flagship',
                reason: 'because',
              },
            ],
            claimsPermitted: report.claimsPermitted,
            claimsPermittedReason: 'stated in the report',
          },
        }),
      )
    }
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('with no benchmark run at all the gate is closed', async () => {
  const verdict = await agentInterfaceGate(join(tmpdir(), 'closer-gate-does-not-exist'))

  expect(verdict.open).toBe(false)
  expect(verdict.reason).toContain('nothing has been run')
})

// A run over constructed inputs proves the pipeline works, not that CLOSER beats anything. It must
// never be the thing that opens a gate.
test('a run over synthetic fixtures does not open the gate', async () => {
  await withReports(
    {
      'run-1': {
        startedAt: '2026-09-10T00:00:00.000Z',
        synthetic: true,
        claimsPermitted: true,
        gapsStatus: 'pass',
      },
    },
    async (dir) => {
      const verdict = await agentInterfaceGate(dir)
      expect(verdict.open).toBe(false)
      expect(verdict.reason).toContain('synthetic')
    },
  )
})

test('a run whose gaps-per-question gate did not pass does not open the gate', async () => {
  await withReports(
    {
      'run-1': {
        startedAt: '2026-09-10T00:00:00.000Z',
        synthetic: false,
        claimsPermitted: true,
        gapsStatus: 'unknown',
      },
    },
    async (dir) => {
      const verdict = await agentInterfaceGate(dir)
      expect(verdict.open).toBe(false)
      expect(verdict.reason).toContain('gaps_per_question')
    },
  )
})

test('the gate reads the latest run, not the most flattering one', async () => {
  await withReports(
    {
      'run-old': {
        startedAt: '2026-09-01T00:00:00.000Z',
        synthetic: false,
        claimsPermitted: true,
        gapsStatus: 'pass',
      },
      'run-new': {
        startedAt: '2026-09-20T00:00:00.000Z',
        synthetic: false,
        claimsPermitted: false,
        gapsStatus: 'fail',
      },
    },
    async (dir) => {
      const verdict = await agentInterfaceGate(dir)
      expect(verdict.open).toBe(false)
      expect(verdict.runId).toBe('run-new')
    },
  )
})

test('a real run that beats the baseline opens it, and says which run did', async () => {
  await withReports(
    {
      'run-1': {
        startedAt: '2026-09-20T00:00:00.000Z',
        synthetic: false,
        claimsPermitted: true,
        gapsStatus: 'pass',
      },
    },
    async (dir) => {
      const verdict = await agentInterfaceGate(dir)
      expect(verdict.open).toBe(true)
      expect(verdict.runId).toBe('run-1')
    },
  )
})
