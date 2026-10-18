import { afterEach, expect, spyOn, test } from 'bun:test'
import { postChatCompletion } from './openai-compatible.ts'
import { StructuredEvaluator } from './evaluator-structured.ts'
import { Type } from '@sinclair/typebox'
import { defaultResilience } from './resilience.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const request = {
  model: 'local/test',
  messages: [{ role: 'user' as const, content: 'SOURCE_SECRET' }],
}

test('the default request has a live deadline signal without changing the body', async () => {
  const timer = spyOn(globalThis, 'setTimeout')
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(init?.signal?.aborted).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual(request)
    return Response.json({ choices: [] })
  }) as unknown as typeof fetch
  try {
    await postChatCompletion('http://127.0.0.1:1/v1', undefined, request)
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 60_000)
  } finally {
    timer.mockRestore()
  }
})

test('caller cancellation aborts an in-flight real HTTP request', async () => {
  const controller = new AbortController()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      controller.abort()
      return new Promise<Response>(() => {})
    },
  })
  try {
    await expect(
      postChatCompletion(`${server.url}v1`, undefined, request, undefined, {
        signal: controller.signal,
        timeoutMs: 500,
      }),
    ).rejects.toHaveProperty('name', 'AbortError')
  } finally {
    await server.stop(true)
  }
})

test('the deadline also aborts response body consumption', async () => {
  let calls = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'))
          },
        }),
      )
    },
  })
  try {
    await expect(
      postChatCompletion(
        `${server.url}v1`,
        undefined,
        request,
        defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
        { timeoutMs: 40 },
      ),
    ).rejects.toHaveProperty('name', 'TimeoutError')
    expect(calls).toBe(1)
  } finally {
    await server.stop(true)
  }
})

test('malformed successful responses do not expose parser source excerpts', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response('SOURCE_SECRET')
  }) as unknown as typeof fetch
  const error = await postChatCompletion(
    'http://127.0.0.1:1',
    undefined,
    request,
    defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
  ).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect(error).not.toBeInstanceOf(TypeError)
  expect(error).toHaveProperty('message', 'Provider returned invalid JSON')
  expect(error).not.toHaveProperty('cause')
  expect(String(error)).not.toContain('SOURCE_SECRET')
  expect(calls).toBe(1)
})

function resetBodyResponse(): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('socket reset SOURCE_SECRET', { cause: 'SOURCE_SECRET' }))
      },
    }),
  )
}

test('response body transport failures retry and can recover', async () => {
  let calls = 0
  const response = { choices: [{ message: { content: 'ok' } }] }
  globalThis.fetch = (async () => {
    calls++
    return calls === 1 ? resetBodyResponse() : Response.json(response)
  }) as unknown as typeof fetch
  await expect(
    postChatCompletion(
      'http://127.0.0.1:1',
      undefined,
      request,
      defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
    ),
  ).resolves.toEqual(response)
  expect(calls).toBe(2)
})

test('repeated response body transport failures exhaust bounded attempts without leaking errors', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return resetBodyResponse()
  }) as unknown as typeof fetch
  const error = await postChatCompletion(
    'http://127.0.0.1:1',
    undefined,
    request,
    defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
  ).catch((error: unknown) => error)
  expect(calls).toBe(3)
  expect(error).toBeInstanceOf(TypeError)
  expect(error).toHaveProperty('message', 'Provider response body transport failed')
  expect(error).not.toHaveProperty('cause')
  expect(String(error)).not.toContain('SOURCE_SECRET')
  expect(JSON.stringify(error)).not.toContain('SOURCE_SECRET')
})

test('body transport retries cannot restart an expired shared deadline', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return resetBodyResponse()
  }) as unknown as typeof fetch
  await expect(
    postChatCompletion(
      'http://127.0.0.1:1',
      undefined,
      request,
      defaultResilience(1, {
        attempts: 3,
        baseMs: 0,
        capMs: 0,
        sleep: () => Bun.sleep(60),
      }),
      { timeoutMs: 20 },
    ),
  ).rejects.toHaveProperty('name', 'TimeoutError')
  expect(calls).toBe(1)
})

test('caller cancellation takes precedence over body transport retry classification', async () => {
  let calls = 0
  const controller = new AbortController()
  globalThis.fetch = (async () => {
    calls++
    controller.abort()
    return resetBodyResponse()
  }) as unknown as typeof fetch
  await expect(
    postChatCompletion(
      'http://127.0.0.1:1',
      undefined,
      request,
      defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
      { signal: controller.signal },
    ),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(calls).toBe(1)
})

test('non-parser body failures remain terminal and sanitized without claiming invalid JSON', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('SOURCE_SECRET', { cause: 'SOURCE_SECRET' }))
        },
      }),
    )
  }) as unknown as typeof fetch
  const error = await postChatCompletion(
    'http://127.0.0.1:1',
    undefined,
    request,
    defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
  ).catch((error: unknown) => error)
  expect(calls).toBe(1)
  expect(error).toHaveProperty('message', 'Provider response body read failed')
  expect(error).not.toHaveProperty('cause')
  expect(String(error)).not.toContain('SOURCE_SECRET')
})

test('a deadline aborts a real hanging HTTP fetch, including retries', async () => {
  let calls = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++
      return new Promise<Response>(() => {})
    },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const call = postChatCompletion(
      `${server.url}v1`,
      undefined,
      request,
      defaultResilience(1, { attempts: 3, baseMs: 0, capMs: 0 }),
      { timeoutMs: 40 },
    )
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fetch did not abort')), 500)
    })
    await expect(Promise.race([call, timeout])).rejects.toHaveProperty('name', 'TimeoutError')
    expect(calls).toBe(1)
  } finally {
    clearTimeout(timer)
    await server.stop(true)
  }
})

test('already cancelled requests never start HTTP work', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({})
  }) as unknown as typeof fetch
  await expect(
    postChatCompletion('http://127.0.0.1:1', undefined, request, undefined, {
      signal: AbortSignal.abort(),
    }),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(calls).toBe(0)
})

test('invalid deadlines fail closed before HTTP work', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({})
  }) as unknown as typeof fetch
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5]) {
    await expect(
      postChatCompletion('http://127.0.0.1:1', undefined, request, undefined, { timeoutMs }),
    ).rejects.toThrow('timeoutMs')
  }
  expect(calls).toBe(0)
})

test('invalid request output budgets fail closed before HTTP work', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({})
  }) as unknown as typeof fetch
  for (const max_tokens of [0, -1, NaN, Infinity, 1.5]) {
    await expect(
      postChatCompletion('http://127.0.0.1:1', undefined, { ...request, max_tokens }),
    ).rejects.toThrow('max_tokens')
  }
  expect(calls).toBe(0)
})

test('provider errors cannot echo source bytes into evaluator transport failures', async () => {
  globalThis.fetch = (async () =>
    new Response('SOURCE_SECRET', { status: 400 })) as unknown as typeof fetch
  const result = await new StructuredEvaluator({
    modelAlias: 'local/test',
    localBaseUrl: 'http://127.0.0.1:1',
  }).complete({
    system: 'system',
    user: 'SOURCE_SECRET',
    schema: Type.Object({ ok: Type.Boolean() }),
    schemaName: 'test',
    maxOutputTokens: 256,
    promptId: 'test',
    promptVersion: 1,
    promptHash: 'test',
  })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.failure.kind).toBe('transport')
    expect(JSON.stringify(result.failure)).not.toContain('SOURCE_SECRET')
  }
})
