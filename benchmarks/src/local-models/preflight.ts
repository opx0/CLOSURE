import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Asset {
  path: string
  sha256: string
}

interface Candidate {
  id: string
  kind: 'streaming_asr' | 'batch_asr' | 'llm'
  runtime: string
  quantization: string
  contextTokens?: number
  assets: Asset[]
}

export interface CandidateManifest {
  version: 1
  candidates: Candidate[]
}

function validManifest(value: unknown): value is CandidateManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<CandidateManifest>
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.candidates) ||
    manifest.candidates.length < 1 ||
    manifest.candidates.length > 3
  )
    return false
  const ids = new Set<string>()
  for (const item of manifest.candidates) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id) ||
      ids.has(item.id) ||
      !['streaming_asr', 'batch_asr', 'llm'].includes(item.kind) ||
      typeof item.runtime !== 'string' ||
      !item.runtime ||
      typeof item.quantization !== 'string' ||
      !item.quantization ||
      (item.kind === 'llm' &&
        (!Number.isSafeInteger(item.contextTokens) || (item.contextTokens ?? 0) < 1)) ||
      !Array.isArray(item.assets) ||
      item.assets.length < 1 ||
      item.assets.length > 8 ||
      item.assets.some(
        (asset) =>
          !asset ||
          typeof asset.path !== 'string' ||
          !asset.path ||
          typeof asset.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(asset.sha256),
      )
    )
      return false
    ids.add(item.id)
  }
  return true
}

async function digestFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const canonical = await realpath(path)
  if (canonical !== resolve(path) || !(await lstat(path)).isFile())
    throw new Error('artifact is not a regular file or uses a symlink')
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  if (bytes === 0) throw new Error('artifact is empty')
  return { sha256: hash.digest('hex'), bytes }
}

export async function preflightLocalModels(value: unknown) {
  if (!validManifest(value)) throw new Error('Invalid local model candidate manifest')
  const candidates = []
  for (const candidate of value.candidates) {
    const assets = []
    for (const asset of candidate.assets) {
      try {
        const measured = await digestFile(asset.path)
        assets.push({
          path: asset.path,
          expectedSha256: asset.sha256,
          ...measured,
          ok: measured.sha256 === asset.sha256,
        })
      } catch (error) {
        assets.push({
          path: asset.path,
          expectedSha256: asset.sha256,
          sha256: null,
          bytes: null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    candidates.push({
      id: candidate.id,
      kind: candidate.kind,
      runtime: candidate.runtime,
      quantization: candidate.quantization,
      contextTokens: candidate.contextTokens ?? null,
      assets,
      artifactReady: assets.every((asset) => asset.ok),
    })
  }
  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    candidates,
    selection: null,
    inference: {
      measured: false,
      meaningCriticalErrors: null,
      asrLagMs: null,
      coldFirstTokenMs: null,
      warmFirstTokenMs: null,
      firstAudioMs: null,
      concurrentResourceUse: null,
      reason: 'Artifact preflight only; no model, reviewed case, or concurrent service was run.',
    },
  }
}
