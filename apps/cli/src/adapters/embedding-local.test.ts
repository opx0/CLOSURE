import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import {
  LocalEmbeddingAdapter,
  validateEmbeddingVector,
  type LocalEmbeddingOptions,
} from './embedding-local.ts'

const revision = 'a'.repeat(64)
const servers: Server[] = []
const defaults: LocalEmbeddingOptions = {
  baseUrl: 'http://127.0.0.1:11434',
  model: 'all-minilm:22m',
  revision,
  dimensions: 3,
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections()
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

interface RecordedRequest {
  path: string
  method: string
  body: Record<string, unknown> | undefined
}

async function fixture(
  options: {
    tags?: unknown
    show?: unknown
    afterEmbed?: () => void
    embeddings?: unknown
    raw?: string
    delayPath?: string
    redirectPath?: string
    status?: number
  } = {},
): Promise<{ baseUrl: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = []
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += String(chunk)
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined
    const path = request.url ?? ''
    requests.push({ path, method: request.method ?? '', body })
    if (path === options.delayPath) return
    if (path === options.redirectPath) {
      response.writeHead(307, { location: 'http://example.com/private' })
      response.end()
      return
    }
    response.setHeader('content-type', 'application/json')
    if (path === '/api/tags') {
      response.end(
        JSON.stringify(options.tags ?? { models: [{ name: defaults.model, digest: revision }] }),
      )
      return
    }
    if (path === '/api/show') {
      response.end(
        JSON.stringify(
          options.show ?? {
            capabilities: ['embedding'],
            model_info: { 'general.architecture': 'bert' },
          },
        ),
      )
      return
    }
    options.afterEmbed?.()
    response.statusCode = options.status ?? 200
    const input = body?.input as string[]
    response.end(
      options.raw ??
        JSON.stringify(
          options.embeddings === undefined
            ? { embeddings: input.map((_, index) => (index % 2 ? [0, 0, 2] : [3, 4, 0])) }
            : options.embeddings,
        ),
    )
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}

describe('LocalEmbeddingAdapter (recording HTTP server, not real-model evidence)', () => {
  test.each([
    {},
    [],
    { capabilities: ['embedding'], model_info: {} },
    { model_info: { architecture: 'bert' } },
  ])('unknown show metadata fails before source inference: %j', async (show) => {
    const { baseUrl, requests } = await fixture({ show })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
    ).rejects.toHaveProperty('name', 'EmbeddingInvalidResponseError')
    expect(requests.map((request) => request.path)).toEqual(['/api/tags', '/api/show'])
    expect(JSON.stringify(requests)).not.toContain('private-source')
    expect(requests[1]?.body?.model).toBe(`sha256:${revision}`)
  })
  test.each([
    {
      remote_host: 'https://ollama.com',
      capabilities: ['embedding'],
      model_info: { architecture: 'bert' },
    },
    {
      remote_model: 'aliased-cloud',
      capabilities: ['embedding'],
      model_info: { architecture: 'bert' },
    },
  ])('rejects remote metadata before any source inference: %j', async (show) => {
    const { baseUrl, requests } = await fixture({ show })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
    ).rejects.toHaveProperty('name', 'EmbeddingRemoteModelError')
    expect(requests.map((request) => request.path)).toEqual(['/api/tags', '/api/show'])
    expect(JSON.stringify(requests)).not.toContain('private-source')
  })

  test.each(['model:cloud', 'model:latest-cloud'])(
    'rejects explicit cloud selector %s',
    (model) => {
      expect(() => new LocalEmbeddingAdapter({ ...defaults, model })).toThrow(
        'Embedding model must be local',
      )
    },
  )

  test('rejects all vectors when digest drifts during inference', async () => {
    const tags = { models: [{ name: defaults.model, digest: revision }] }
    const { baseUrl, requests } = await fixture({
      tags,
      afterEmbed: () => {
        tags.models[0]!.digest = 'b'.repeat(64)
      },
    })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedDocuments(['first', 'second']),
    ).rejects.toHaveProperty('name', 'EmbeddingDigestMismatchError')
    expect(requests.map((request) => request.path)).toEqual([
      '/api/tags',
      '/api/show',
      '/api/embed',
      '/api/tags',
    ])
  })

  test('rejects all vectors when locality drifts during inference', async () => {
    const show = {
      capabilities: ['embedding'],
      model_info: { architecture: 'bert' },
      remote_host: '',
    }
    const { baseUrl } = await fixture({
      show,
      afterEmbed: () => {
        show.remote_host = 'https://ollama.com'
      },
    })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('source'),
    ).rejects.toHaveProperty('name', 'EmbeddingRemoteModelError')
  })

  test('native requests preserve batches, order, prefixes, digest gate and truncate:false', async () => {
    const { baseUrl, requests } = await fixture()
    const adapter = new LocalEmbeddingAdapter({
      ...defaults,
      baseUrl,
      maxBatchSize: 2,
      queryPrefix: 'query: ',
      documentPrefix: 'document: ',
    })
    expect(await adapter.embedDocuments(['one', 'two', 'three'])).toEqual([
      [0.6, 0.8, 0],
      [0, 0, 1],
      [0.6, 0.8, 0],
    ])
    expect(await adapter.embedQuery('question')).toEqual([0.6, 0.8, 0])
    expect(requests.map((request) => request.path)).toEqual([
      '/api/tags',
      '/api/show',
      '/api/embed',
      '/api/tags',
      '/api/show',
      '/api/tags',
      '/api/show',
      '/api/embed',
      '/api/tags',
      '/api/show',
      '/api/tags',
      '/api/show',
      '/api/embed',
      '/api/tags',
      '/api/show',
    ])
    expect(requests[2]).toEqual({
      path: '/api/embed',
      method: 'POST',
      body: {
        model: `sha256:${revision}`,
        input: ['document: one', 'document: two'],
        truncate: false,
      },
    })
    expect(requests.filter((request) => request.path === '/api/embed')[1]?.body?.input).toEqual([
      'document: three',
    ])
    expect(requests.filter((request) => request.path === '/api/embed')[2]?.body?.input).toEqual([
      'query: question',
    ])
  })

  test('profile is immutable, complete and fingerprints the encoding recipe only', () => {
    const adapter = new LocalEmbeddingAdapter(defaults)
    expect(Object.isFrozen(adapter.profile)).toBe(true)
    expect(adapter.profile).toEqual({
      id: expect.stringMatching(/^ollama:[a-f0-9]{64}$/),
      model: defaults.model,
      revision: `sha256:${revision}`,
      dimensions: 3,
      normalization: 'l2',
      pooling: 'ollama-model-defined',
      tokenizer: `ollama-model:sha256:${revision}`,
      maxInputTokens: 512,
      preprocessingVersion: 'utf8-byte-upper-bound+8-special-tokens-v1',
      queryPrefix: '',
      documentPrefix: '',
    })
    expect(
      new LocalEmbeddingAdapter({
        ...defaults,
        revision: `sha256:${revision.toUpperCase()}`,
        timeoutMs: 9,
      }).profile.id,
    ).toBe(adapter.profile.id)
    for (const change of [
      { queryPrefix: 'query: ' },
      { documentPrefix: 'passage: ' },
      { dimensions: 384 },
      { maxInputTokens: 256 },
      { model: 'other' },
      { revision: 'b'.repeat(64) },
    ]) {
      expect(new LocalEmbeddingAdapter({ ...defaults, ...change }).profile.id).not.toBe(
        adapter.profile.id,
      )
    }
  })

  test('empty collection has no I/O; empty text remains an explicit single input', async () => {
    const { baseUrl, requests } = await fixture()
    const adapter = new LocalEmbeddingAdapter({ ...defaults, baseUrl })
    expect(await adapter.embedDocuments([])).toEqual([])
    expect(requests).toEqual([])
    expect(await adapter.embedQuery('')).toEqual([0.6, 0.8, 0])
    expect(requests[2]?.body?.input).toEqual([''])
  })

  test('rechecks digest on repeated calls instead of caching a floating model tag', async () => {
    const tags = { models: [{ name: defaults.model, digest: revision }] }
    const { baseUrl, requests } = await fixture({ tags })
    const adapter = new LocalEmbeddingAdapter({ ...defaults, baseUrl })
    await adapter.embedQuery('first')
    tags.models[0]!.digest = 'b'.repeat(64)
    await expect(adapter.embedQuery('second')).rejects.toHaveProperty(
      'name',
      'EmbeddingDigestMismatchError',
    )
    expect(requests.map((request) => request.path)).toEqual([
      '/api/tags',
      '/api/show',
      '/api/embed',
      '/api/tags',
      '/api/show',
      '/api/tags',
    ])
  })

  test('UTF-8 bound includes prefix and special-token margin, validating all before I/O', async () => {
    const { baseUrl, requests } = await fixture()
    const adapter = new LocalEmbeddingAdapter({
      ...defaults,
      baseUrl,
      maxInputTokens: 12,
      documentPrefix: 'x',
      maxBatchSize: 1,
    })
    await expect(adapter.embedDocuments(['a', '😀'])).rejects.toHaveProperty(
      'name',
      'EmbeddingInputTooLargeError',
    )
    expect(requests).toEqual([])
    await adapter.embedDocuments(['€']) // 1 prefix byte + 3 UTF-8 bytes + 8 special tokens.
    expect(requests[2]?.body?.input).toEqual(['x€'])
  })

  test.each([
    [{ models: [] }, 'EmbeddingModelUnavailableError'],
    [
      { models: [{ name: defaults.model, digest: 'b'.repeat(64) }] },
      'EmbeddingDigestMismatchError',
    ],
    [{ models: [{ name: defaults.model, digest: 'latest' }] }, 'EmbeddingInvalidResponseError'],
    [[], 'EmbeddingInvalidResponseError'],
  ])('digest verification blocks source requests: %j', async (tags, name) => {
    const { baseUrl, requests } = await fixture({ tags })
    const adapter = new LocalEmbeddingAdapter({ ...defaults, baseUrl })
    await expect(adapter.embedQuery('private-source')).rejects.toHaveProperty('name', name)
    await expect(adapter.embedQuery('private-source')).rejects.toHaveProperty('name', name)
    expect(requests.map((request) => request.path)).toEqual(['/api/tags', '/api/tags'])
    expect(JSON.stringify(requests)).not.toContain('private-source')
  })

  test.each([
    null,
    [],
    {},
    { embeddings: [] },
    { embeddings: [[1, 2]] },
    { embeddings: [[0, 0, 0]] },
    { embeddings: [[1, '2', 3]] },
    { embeddings: [[1, null, 3]] },
    {
      embeddings: [
        [1, 2, 3],
        [1, 2, 3],
      ],
    },
  ])('rejects malformed response/vectors: %j', async (embeddings) => {
    const { baseUrl } = await fixture({ embeddings })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
    ).rejects.toHaveProperty('name', 'EmbeddingInvalidResponseError')
  })

  test('rejects nonfinite values, including nonstandard NaN JSON', async () => {
    for (const vector of [
      [NaN, 1, 2],
      [Infinity, 1, 2],
      [-Infinity, 1, 2],
    ]) {
      expect(() => validateEmbeddingVector(vector, 3)).toThrow('Invalid local embedding response')
    }
    const { baseUrl } = await fixture({ raw: '{"embeddings":[[NaN,1,2]]}' })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
    ).rejects.toHaveProperty('name', 'EmbeddingInvalidResponseError')
    expect(validateEmbeddingVector([Number.MAX_VALUE, Number.MAX_VALUE, 0], 3)[0]).toBeCloseTo(
      1 / Math.sqrt(2),
    )
  })

  test.each(['/api/tags', '/api/show', '/api/embed'])('bounds timeout at %s', async (delayPath) => {
    const { baseUrl } = await fixture({ delayPath })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl, timeoutMs: 50 }).embedQuery(
        'private-source',
      ),
    ).rejects.toHaveProperty('name', 'EmbeddingTimeoutError')
  })

  test.each(['/api/tags', '/api/show', '/api/embed'])(
    'never follows redirects at %s',
    async (redirectPath) => {
      const { baseUrl, requests } = await fixture({ redirectPath })
      await expect(
        new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
      ).rejects.toHaveProperty('name', 'EmbeddingModelUnavailableError')
      expect(requests.length).toBe(
        redirectPath === '/api/tags' ? 1 : redirectPath === '/api/show' ? 2 : 3,
      )
    },
  )

  test('HTTP and parse failures never expose provider bodies or source text', async () => {
    for (const status of [200, 500]) {
      const { baseUrl } = await fixture({ status, raw: 'private-source secret-response' })
      try {
        await new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source')
        throw new Error('Expected adapter failure')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(error).toHaveProperty(
          'name',
          status === 200 ? 'EmbeddingInvalidResponseError' : 'EmbeddingModelUnavailableError',
        )
        expect(String(error)).not.toContain('private-source')
        expect(String(error)).not.toContain('secret-response')
        expect(error).not.toHaveProperty('cause')
      }
    }
  })

  test('bounds response bytes without echoing oversized bodies', async () => {
    const { baseUrl } = await fixture({ raw: 'x'.repeat(16 * 1024 * 1024 + 1) })
    await expect(
      new LocalEmbeddingAdapter({ ...defaults, baseUrl }).embedQuery('private-source'),
    ).rejects.toHaveProperty('name', 'EmbeddingInvalidResponseError')
  })

  test.each([
    'https://localhost:11434',
    'http://example.com',
    'http://127.0.0.2',
    'http://127.1',
    'http://2130706433',
    'http://localhost.evil.com',
    'http://user:password@localhost',
    'http://localhost/api',
    'http://localhost/../',
    'http://localhost/%2e%2e/',
    'http://localhost?secret',
    'http://localhost#secret',
    'http://localhost\\@example.com',
  ])('rejects remote or ambiguous endpoint %s', (baseUrl) => {
    expect(() => new LocalEmbeddingAdapter({ ...defaults, baseUrl })).toThrow(
      'Embedding endpoint must be a loopback HTTP origin',
    )
  })

  test('accepts only supported loopback spellings', () => {
    for (const baseUrl of ['http://localhost:11434/', 'http://127.0.0.1', 'http://[::1]:11434']) {
      expect(() => new LocalEmbeddingAdapter({ ...defaults, baseUrl })).not.toThrow()
    }
  })

  test.each([
    { revision: 'latest' },
    { revision: '' },
    { model: '' },
    { dimensions: 0 },
    { dimensions: 1.5 },
    { maxInputTokens: 8 },
    { maxInputTokens: Infinity },
    { maxBatchSize: 0 },
    { timeoutMs: 0 },
    { timeoutMs: Infinity },
  ])('rejects invalid configuration %j', (change) => {
    expect(() => new LocalEmbeddingAdapter({ ...defaults, ...change })).toThrow()
  })
})
