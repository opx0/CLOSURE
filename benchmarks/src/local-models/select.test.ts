import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'bun:test'

const exec = promisify(execFile)

test('select-cli chooses the best candidate meeting all limits and records disposition', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-select-test-'))
  try {
    const dummyModel = join(dir, 'dummy.gguf')
    await writeFile(dummyModel, 'dummy-weights-content')
    const sha256 = createHash('sha256').update('dummy-weights-content').digest('hex')

    const manifest = {
      version: 1,
      candidates: [
        {
          id: 'model-a',
          kind: 'llm',
          runtime: 'llama.cpp',
          quantization: 'Q4_K_M',
          contextTokens: 4096,
          assets: [{ path: dummyModel, sha256 }],
        },
        {
          id: 'model-b',
          kind: 'llm',
          runtime: 'llama.cpp',
          quantization: 'Q8_0',
          contextTokens: 4096,
          assets: [{ path: dummyModel, sha256 }],
        },
      ],
    }
    const manifestPath = join(dir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest))

    const cases = [
      { id: 'case-1', prompt: 'Explain virtual memory.', reviewedBy: 'rev1' },
      { id: 'case-2', prompt: 'Explain deadlock conditions.', reviewedBy: 'rev1' },
    ]
    const caseBytes = Buffer.from(JSON.stringify(cases), 'utf8')
    const casesPath = join(dir, 'cases.json')
    await writeFile(casesPath, caseBytes)
    const casesSha256 = createHash('sha256').update(caseBytes).digest('hex')

    const limits = {
      meaningCriticalErrors: 1,
      asrLagP95Ms: 500,
      coldFirstTokenMs: 2000,
      warmFirstTokenMs: 800,
      firstAudioMs: 1000,
      peakRamBytes: 8 * 1024 * 1024 * 1024,
      peakVramBytes: 4 * 1024 * 1024 * 1024,
      peakCpuPercent: 80,
    }

    const observations = {
      version: 1,
      kind: 'llm',
      casesSha256,
      limits,
      observations: [
        {
          candidateId: 'model-a',
          loadedArtifactDigestsVerifiedBy: 'tester',
          measuredAt: '2026-10-30T12:00:00Z',
          reviewer: 'reviewer-1',
          configuration: 'llama.cpp b3000 --threads 8',
          cases: [
            { id: 'case-1', meaningCriticalErrors: 0, reviewedBy: 'reviewer-1' },
            { id: 'case-2', meaningCriticalErrors: 0, reviewedBy: 'reviewer-1' },
          ],
          metrics: {
            asrLagP95Ms: 0,
            coldFirstTokenMs: 1200,
            warmFirstTokenMs: 350,
            firstAudioMs: 0,
            peakRamBytes: 3 * 1024 * 1024 * 1024,
            peakVramBytes: 2 * 1024 * 1024 * 1024,
            peakCpuPercent: 45,
          },
        },
        {
          candidateId: 'model-b',
          loadedArtifactDigestsVerifiedBy: 'tester',
          measuredAt: '2026-10-30T12:00:00Z',
          reviewer: 'reviewer-1',
          configuration: 'llama.cpp b3000 --threads 8',
          cases: [
            { id: 'case-1', meaningCriticalErrors: 0, reviewedBy: 'reviewer-1' },
            { id: 'case-2', meaningCriticalErrors: 0, reviewedBy: 'reviewer-1' },
          ],
          metrics: {
            asrLagP95Ms: 0,
            coldFirstTokenMs: 1500,
            warmFirstTokenMs: 550,
            firstAudioMs: 0,
            peakRamBytes: 4 * 1024 * 1024 * 1024,
            peakVramBytes: 3 * 1024 * 1024 * 1024,
            peakCpuPercent: 60,
          },
        },
      ],
    }
    const observationsPath = join(dir, 'observations.json')
    await writeFile(observationsPath, JSON.stringify(observations))

    const reportPath = join(dir, 'report.json')
    const selectScript = join(process.cwd(), 'benchmarks/src/local-models/select-cli.ts')

    const { stdout } = await exec('bun', [
      selectScript,
      manifestPath,
      casesPath,
      observationsPath,
      reportPath,
    ])
    expect(stdout).toContain('Provisional selection: model-a')

    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      disposition: string
      selectedCandidateId: string
      results: Array<{ candidate: { id: string }; feasible: boolean }>
    }
    expect(report.disposition).toBe('provisional_selection')
    expect(report.selectedCandidateId).toBe('model-a')
    expect(report.results.every((r) => r.feasible)).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('select-cli rejects mismatched case digests or conflicting configurations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-select-mismatch-'))
  try {
    const dummyModel = join(dir, 'dummy.gguf')
    await writeFile(dummyModel, 'model-bytes')
    const sha256 = createHash('sha256').update('model-bytes').digest('hex')

    const manifestPath = join(dir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        candidates: [
          {
            id: 'm1',
            kind: 'llm',
            runtime: 'llama.cpp',
            quantization: 'Q4',
            contextTokens: 2048,
            assets: [{ path: dummyModel, sha256 }],
          },
        ],
      }),
    )

    const casesPath = join(dir, 'cases.json')
    await writeFile(casesPath, JSON.stringify([{ id: 'c1' }]))

    const observationsPath = join(dir, 'observations.json')
    await writeFile(
      observationsPath,
      JSON.stringify({
        version: 1,
        kind: 'llm',
        casesSha256: '0'.repeat(64), // deliberately wrong digest
        limits: {
          meaningCriticalErrors: 0,
          asrLagP95Ms: 0,
          coldFirstTokenMs: 0,
          warmFirstTokenMs: 0,
          firstAudioMs: 0,
          peakRamBytes: 0,
          peakVramBytes: 0,
          peakCpuPercent: 0,
        },
        observations: [
          {
            candidateId: 'm1',
            loadedArtifactDigestsVerifiedBy: 'tester',
            measuredAt: '2026-10-30T12:00:00Z',
            reviewer: 'reviewer',
            configuration: 'default',
            cases: [{ id: 'c1', meaningCriticalErrors: 0, reviewedBy: 'reviewer' }],
            metrics: {
              asrLagP95Ms: 0,
              coldFirstTokenMs: 0,
              warmFirstTokenMs: 0,
              firstAudioMs: 0,
              peakRamBytes: 0,
              peakVramBytes: 0,
              peakCpuPercent: 0,
            },
          },
        ],
      }),
    )

    const selectScript = join(process.cwd(), 'benchmarks/src/local-models/select-cli.ts')
    await expect(
      exec('bun', [selectScript, manifestPath, casesPath, observationsPath, join(dir, 'out.json')]),
    ).rejects.toThrow('Case file digest differs')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
