import { createHash } from 'node:crypto'
import type { EmbeddingPort, EmbeddingProfile } from '@levelhead/core'

export interface LocalEmbeddingOptions {
  baseUrl: string
  model: string
  revision: string
  dimensions: number
  maxInputTokens?: number
  maxBatchSize?: number
  timeoutMs?: number
  queryPrefix?: string
  documentPrefix?: string
}

type EmbeddingErrorName =
  | 'EmbeddingRemoteEndpointError'
  | 'EmbeddingRemoteModelError'
  | 'EmbeddingConfigurationError'
  | 'EmbeddingModelUnavailableError'
  | 'EmbeddingDigestMismatchError'
  | 'EmbeddingInvalidResponseError'
  | 'EmbeddingInputTooLargeError'
  | 'EmbeddingTimeoutError'

export class LocalEmbeddingError extends Error {
  constructor(name: EmbeddingErrorName, message: string) {
    super(message)
    this.name = name
  }
}

function invalidResponse(): never {
  throw new LocalEmbeddingError('EmbeddingInvalidResponseError', 'Invalid local embedding response')
}

function digest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.replace(/^sha256:/i, '').toLowerCase()
  return /^[a-f0-9]{64}$/.test(hex) ? `sha256:${hex}` : undefined
}

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new LocalEmbeddingError('EmbeddingConfigurationError', 'Invalid embedding configuration')
  }
  return value
}

function loopbackUrl(value: string): string {
  // Check the original authority too: URL canonicalization accepts alternative numeric IP forms.
  const authority = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/i
  try {
    const url = new URL(value)
    if (
      !authority.test(value) ||
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error()
    }
    return url.origin
  } catch {
    throw new LocalEmbeddingError(
      'EmbeddingRemoteEndpointError',
      'Embedding endpoint must be a loopback HTTP origin',
    )
  }
}

/** Validate provider vectors before local normalization; never repair invalid or zero vectors. */
export function validateEmbeddingVector(value: unknown, dimensions: number): readonly number[] {
  if (!Array.isArray(value) || value.length !== dimensions) invalidResponse()
  let scale = 0
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component)) invalidResponse()
    scale = Math.max(scale, Math.abs(component))
  }
  if (scale === 0) invalidResponse()
  // Scaling first avoids overflow/underflow for finite but extreme provider values.
  const scaled: number[] = value.map((component: number) => component / scale)
  const norm = Math.sqrt(scaled.reduce((sum, component) => sum + component * component, 0))
  return scaled.map((component) => component / norm)
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class LocalEmbeddingAdapter implements EmbeddingPort {
  readonly profile: EmbeddingProfile
  private readonly baseUrl: string
  private readonly maxBatchSize: number
  private readonly timeoutMs: number

  constructor(options: LocalEmbeddingOptions) {
    this.baseUrl = loopbackUrl(options.baseUrl)
    const revision = digest(options.revision)
    if (!revision || typeof options.model !== 'string' || !options.model.trim()) {
      throw new LocalEmbeddingError(
        'EmbeddingConfigurationError',
        'A model and exact SHA256 artifact digest are required',
      )
    }
    // Explicit cloud selectors must not even reach /api/show (which may proxy metadata).
    if (/(?:^|[:/])cloud(?:$|\/)|-cloud$/i.test(options.model)) {
      throw new LocalEmbeddingError('EmbeddingRemoteModelError', 'Embedding model must be local')
    }
    const queryPrefix = options.queryPrefix ?? ''
    const documentPrefix = options.documentPrefix ?? ''
    if (typeof queryPrefix !== 'string' || typeof documentPrefix !== 'string') {
      throw new LocalEmbeddingError('EmbeddingConfigurationError', 'Invalid embedding prefixes')
    }
    const recipe = {
      model: options.model,
      revision,
      dimensions: integer(options.dimensions, 1, 65_536),
      normalization: 'l2' as const,
      // Ollama applies pooling defined by the pinned model, not a client-selected mean/CLS rule.
      pooling: 'ollama-model-defined',
      tokenizer: `ollama-model:${revision}`,
      maxInputTokens: integer(options.maxInputTokens ?? 512, 9, 1_048_576),
      // No tokenizer is bundled: one UTF-8 byte per token plus eight special tokens is a
      // conservative input bound, not a measured token count. Prefixes are included; no trimming.
      preprocessingVersion: 'utf8-byte-upper-bound+8-special-tokens-v1',
      queryPrefix,
      documentPrefix,
    }
    this.profile = Object.freeze({
      id: `ollama:${createHash('sha256').update(JSON.stringify(recipe)).digest('hex')}`,
      ...recipe,
    })
    this.maxBatchSize = integer(options.maxBatchSize ?? 16, 1, 128)
    this.timeoutMs = integer(options.timeoutMs ?? 30_000, 1, 120_000)
  }

  async embedQuery(text: string): Promise<readonly number[]> {
    const vectors = await this.embed([text], this.profile.queryPrefix)
    return vectors[0]!
  }

  async embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return this.embed(texts, this.profile.documentPrefix)
  }

  private async embed(
    texts: readonly string[],
    prefix: string,
  ): Promise<readonly (readonly number[])[]> {
    // Validate the whole call before sending any source; chunking is the caller's responsibility.
    const inputs = texts.map((text) => {
      if (typeof text !== 'string') {
        throw new LocalEmbeddingError('EmbeddingConfigurationError', 'Embedding input must be text')
      }
      const input = prefix + text
      if (Buffer.byteLength(input, 'utf8') + 8 > this.profile.maxInputTokens) {
        throw new LocalEmbeddingError(
          'EmbeddingInputTooLargeError',
          'Embedding input exceeds the conservative token budget; chunk before embedding',
        )
      }
      return input
    })
    // An empty collection does no I/O; an empty string is a valid single model input.
    const result: (readonly number[])[] = []
    for (let offset = 0; offset < inputs.length; offset += this.maxBatchSize) {
      await this.verifyDigest()
      const batch = inputs.slice(offset, offset + this.maxBatchSize)
      const response = await this.request('/api/embed', {
        model: this.profile.revision,
        input: batch,
        truncate: false,
      })
      // Tags are mutable: reject every result if the observed artifact/locality changed.
      // This is drift detection, not atomic pinning against a concurrently mutating server.
      await this.verifyDigest()
      if (!object(response) || !Array.isArray(response.embeddings)) invalidResponse()
      if (response.embeddings.length !== batch.length) invalidResponse()
      // Native Ollama arrays preserve request order; do not sort or invent provider indices.
      result.push(
        ...response.embeddings.map((vector: unknown) =>
          validateEmbeddingVector(vector, this.profile.dimensions),
        ),
      )
    }
    return result
  }

  private async verifyDigest(): Promise<void> {
    const response = await this.request('/api/tags')
    if (!object(response) || !Array.isArray(response.models)) invalidResponse()
    const selected = response.models.find(
      (entry: unknown) =>
        object(entry) && (entry.name === this.profile.model || entry.model === this.profile.model),
    ) as Record<string, unknown> | undefined
    if (!selected) {
      throw new LocalEmbeddingError(
        'EmbeddingModelUnavailableError',
        'Pinned embedding model missing',
      )
    }
    const actual = digest(selected.digest)
    if (!actual) invalidResponse()
    if (actual !== this.profile.revision) {
      throw new LocalEmbeddingError(
        'EmbeddingDigestMismatchError',
        'Embedding model digest mismatch',
      )
    }
    if (
      ['remote_host', 'remote_model'].some(
        (key) => selected[key] !== undefined && selected[key] !== '',
      )
    ) {
      throw new LocalEmbeddingError('EmbeddingRemoteModelError', 'Embedding model must be local')
    }
    // Native digest references are supported by the validated Ollama runtime. Require them:
    // unsupported runtimes fail here before source inference, never fall back to a mutable tag.
    const metadata = await this.request('/api/show', { model: this.profile.revision })
    if (!object(metadata)) invalidResponse()
    for (const record of [selected, metadata]) {
      if (
        ['remote_host', 'remote_model'].some(
          (key) => record[key] !== undefined && record[key] !== '',
        )
      ) {
        throw new LocalEmbeddingError('EmbeddingRemoteModelError', 'Embedding model must be local')
      }
    }
    // Official ShowResponse exposes remote_host/remote_model and local model metadata.
    // Require a real embedding-capable local artifact rather than an empty/unknown response.
    if (
      !object(metadata.model_info) ||
      !Array.isArray(metadata.capabilities) ||
      !metadata.capabilities.includes('embedding') ||
      Object.keys(metadata.model_info).length === 0
    ) {
      invalidResponse()
    }
  }

  private async request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(this.baseUrl + path, {
        method: body ? 'POST' : 'GET',
        ...(body
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new LocalEmbeddingError(
          'EmbeddingModelUnavailableError',
          `Local embedding service returned HTTP ${response.status}`,
        )
      }
      const reader = response.body?.getReader()
      if (!reader) invalidResponse()
      const chunks: Uint8Array[] = []
      let bytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 16 * 1024 * 1024) {
          await reader.cancel()
          invalidResponse()
        }
        chunks.push(value)
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      } catch {
        invalidResponse()
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LocalEmbeddingError('EmbeddingTimeoutError', 'Local embedding request timed out')
      }
      if (error instanceof LocalEmbeddingError) throw error
      // Provider errors can echo source content: do not retain bodies, URLs or underlying causes.
      throw new LocalEmbeddingError(
        'EmbeddingModelUnavailableError',
        'Local embedding service unavailable',
      )
    } finally {
      clearTimeout(timer)
    }
  }
}
