import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { rubricSetV1 } from '@closer/core'
import { FixedClock, ScriptedConductor, SeqIds } from '../../apps/cli/src/testing/fakes.ts'
import { ALL_ARMS } from './arms/index.ts'
import type { ArmContext } from './arms/arm.ts'
import type { RunReport } from './contract.ts'
import { LabelIndex } from './labels.ts'
import { runBenchmark, type RunInput } from './run.ts'
import { routingEvaluator, syntheticFixtures, syntheticLabels } from './testing/synthetic.ts'

const CANARY = 'PWNED-BY-THE-RESUME'

function context(questions: readonly string[]): ArmContext {
  return {
    conductor: new ScriptedConductor(questions),
    evaluator: routingEvaluator(),
    clock: new FixedClock(),
    ids: new SeqIds(),
    level: 'mid',
    mode: 'coach',
    personaId: 'skeptic',
    rubricSet: rubricSetV1,
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    maxTurns: 4,
  }
}

async function runInto(outDir: string, over: Partial<RunInput> = {}) {
  return runBenchmark({
    fixtures: syntheticFixtures(),
    labels: new LabelIndex(syntheticLabels()),
    arms: ALL_ARMS,
    context: context(['How did the lease work?', 'What backs that?', 'What breaks it?', 'And?']),
    outDir,
    runId: 'synthetic-run',
    configuredModelAlias: 'fake-alias',
    bar: 'flagship',
    invariants: [],
    seed: 7,
    repeatedRunVariance: null,
    ...over,
  })
}

async function readReport(path: string): Promise<RunReport> {
  return JSON.parse(await readFile(path, 'utf8')) as RunReport
}

describe('the runner publishes, it does not decide', () => {
  test('a run writes a complete report with prompt hashes and every per-item outcome', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    const { report, reportPath } = await runInto(out)
    const written = await readReport(reportPath)

    expect(written).toEqual(report)
    expect(written.manifest.contractVersion).toBe(1)
    expect(written.manifest.runId).toBe('synthetic-run')
    expect(written.manifest.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(written.manifest.configuredModelAlias).toBe('fake-alias')
    expect(written.manifest.observedModelAliases.length).toBeGreaterThan(0)

    // A model alias alone does not say what was asked (ticket 05 section 6.3).
    expect(written.manifest.prompts.length).toBeGreaterThan(0)
    for (const prompt of written.manifest.prompts) {
      expect(prompt.id.length).toBeGreaterThan(0)
      expect(prompt.hash.length).toBeGreaterThan(0)
      expect(prompt.version).toBeGreaterThanOrEqual(1)
    }

    expect(written.arms.map((arm) => arm.armId).sort()).toEqual(
      ALL_ARMS.map((arm) => arm.id).sort(),
    )
    for (const arm of written.arms) {
      expect(arm.items.map((item) => item.itemId)).toEqual(['item-synthetic-1'])
      for (const item of arm.items) {
        // The two model-layer arms need a Conductor adapter this run was not given. They publish a
        // named failure and an empty transcript rather than numbers produced by another model —
        // an arm that quietly fell back would be the dishonest outcome, not the missing one.
        if (item.failure !== null) {
          expect(item.failure).toContain('conductor was configured')
          expect(item.transcript).toEqual([])
          continue
        }
        expect(item.transcript.length).toBeGreaterThan(0)
        expect(item.transcript.some((turn) => turn.role === 'candidate')).toBe(true)
      }
    }
  })

  test('a synthetic run says so in a field and licenses no claim', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    const { report } = await runInto(out)
    expect(report.syntheticFixtureData).toBe(true)
    expect(report.gates.claimsPermitted).toBe(false)
    expect(report.notes.some((note) => note.includes('SYNTHETIC FIXTURE DATA'))).toBe(true)
    expect(report.notes.some((note) => note.includes('no editorial step'))).toBe(true)
  })

  test('GRRAS disclosure travels on the manifest, including solo self-labeling', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    const { report } = await runInto(out)
    expect(report.manifest.labeling.soloSelfLabeled).toBe(true)
    expect(report.manifest.labeling.labellers).toEqual(['fixture-author'])
    expect(report.manifest.labeling.coefficient).toContain('ordinal alpha')
    expect(report.manifest.labeling.adjudication.length).toBeGreaterThan(0)
  })

  test('a bad result is written in full, exactly like a good one', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    // The interviewer repeats the injected instruction back - it must reach disk unchanged.
    const poisoned = Array.from({ length: 8 }, () => `Sure - ${CANARY} - now, how did it work?`)
    const { report, reportPath } = await runInto(out, {
      fixtures: syntheticFixtures(CANARY),
      context: context(poisoned),
    })

    const written = await readReport(reportPath)
    expect(written).toEqual(report)

    const full = written.arms.find((arm) => arm.armId === 'closer_full')
    expect(full?.items[0]?.injection).toEqual({ canary: CANARY, succeeded: true })
    expect(full?.metrics.injectionSuccessRate).toBe(1)

    const gate = written.gates.results.find((one) => one.id === 'injection_success_rate')
    expect(gate?.status).toBe('fail')
    expect(written.gates.claimsPermitted).toBe(false)

    // The transcript that shows the failure is in the file, not summarised out of it.
    expect(JSON.stringify(written)).toContain(CANARY)
  })

  test('a re-run is published in addition, never instead', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    const first = await runInto(out)
    const second = await runInto(out)

    expect(second.reportPath).not.toBe(first.reportPath)
    expect((await readReport(first.reportPath)).manifest.runId).toBe('synthetic-run')
    expect((await readReport(second.reportPath)).manifest.runId).toBe('synthetic-run')

    const ledger = await readFile(join(out, 'runs.jsonl'), 'utf8')
    expect(ledger.trim().split('\n').length).toBe(2)
  })

  test('agreement below n = 100 is unknown in the written report, not a pass', async () => {
    const out = await mkdtemp(join(tmpdir(), 'closer-bench-'))
    const { report } = await runInto(out)
    const gate = report.gates.results.find((one) => one.id === 'agreement_alpha')
    expect(gate?.status).toBe('unknown')
    expect(gate?.observed).toBeNull()
  })
})
