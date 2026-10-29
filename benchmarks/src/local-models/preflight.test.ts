import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { preflightLocalModels } from './preflight.ts'

test('local artifacts are digest-checked, while selection and inference remain unmeasured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-model-preflight-'))
  try {
    const file = join(dir, 'tiny.gguf')
    await writeFile(file, 'test model bytes')
    const sha256 = createHash('sha256').update('test model bytes').digest('hex')
    const manifest = {
      version: 1,
      candidates: [
        {
          id: 'local-llm',
          kind: 'llm',
          runtime: 'llama.cpp',
          quantization: 'Q4_K_M',
          contextTokens: 4096,
          assets: [{ path: file, sha256 }],
        },
        {
          id: 'missing-asr',
          kind: 'streaming_asr',
          runtime: 'sherpa-onnx',
          quantization: 'int8',
          assets: [{ path: join(dir, 'missing.onnx'), sha256 }],
        },
      ],
    }
    const report = await preflightLocalModels(manifest)
    expect(report.candidates.map((candidate) => candidate.artifactReady)).toEqual([true, false])
    expect(report.candidates[0]?.assets[0]).toMatchObject({ sha256, bytes: 16, ok: true })
    expect(report.selection).toBeNull()
    expect(report.inference.measured).toBe(false)
    await writeFile(file, 'changed model bytes')
    expect((await preflightLocalModels(manifest)).candidates[0]?.artifactReady).toBe(false)
    await mkdir(join(dir, 'elsewhere'))
    await symlink(file, join(dir, 'linked.gguf'))
    const symlinkManifest = {
      version: 1,
      candidates: [
        { ...manifest.candidates[0], assets: [{ path: join(dir, 'linked.gguf'), sha256 }] },
      ],
    }
    expect((await preflightLocalModels(symlinkManifest)).candidates[0]?.artifactReady).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('candidate count, identity, digest and LLM context are required before any file read', async () => {
  const candidate = {
    id: 'a',
    kind: 'llm',
    runtime: 'local',
    quantization: 'Q4',
    contextTokens: 4096,
    assets: [{ path: '/not/read', sha256: 'a'.repeat(64) }],
  }
  await expect(
    preflightLocalModels({ version: 1, candidates: Array(4).fill(candidate) }),
  ).rejects.toThrow('Invalid local model candidate manifest')
  await expect(
    preflightLocalModels({ version: 1, candidates: [candidate, { ...candidate }] }),
  ).rejects.toThrow('Invalid local model candidate manifest')
  await expect(
    preflightLocalModels({ version: 1, candidates: [{ ...candidate, contextTokens: 0 }] }),
  ).rejects.toThrow('Invalid local model candidate manifest')
})
