import { expect, test } from 'bun:test'
import { fromEnv } from './index.ts'
import { checkLocalGeneration } from './local-only.ts'
import { postChatCompletion } from './openai-compatible.ts'

test('local-only adapters reject hosted keys and non-loopback endpoints before a request', () => {
  for (const base of ['http://127.0.0.1:8081/v1', 'http://[::1]:8081/v1', 'https://localhost/v1']) {
    expect(() =>
      checkLocalGeneration({ LEVELHEAD_LOCAL_ONLY: 'true', LLAMA_BASE_URL: base }),
    ).not.toThrow()
  }
  for (const base of [
    'https://example.com/v1',
    'http://localhost.example.com',
    'http://user:secret@localhost',
    'file:///tmp/model',
    'http://localhost/?key=secret',
  ]) {
    expect(() => fromEnv({ LEVELHEAD_LOCAL_ONLY: 'true', LLAMA_BASE_URL: base })).toThrow(
      'loopback',
    )
  }
  expect(() => fromEnv({ LEVELHEAD_LOCAL_ONLY: 'true', MODEL_PROVIDER_API_KEY: 'secret' })).toThrow(
    'unset it',
  )
  expect(() => fromEnv({ LEVELHEAD_LOCAL_ONLY: 'yes' })).toThrow('true or false')
})

test('generation transport does not follow redirects', async () => {
  let escaped = false
  const target = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      escaped = true
      return Response.json({})
    },
  })
  const redirect = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response(null, { status: 307, headers: { location: `${target.url}outside` } })
    },
  })
  try {
    await expect(
      postChatCompletion(redirect.url.toString(), undefined, {
        model: 'local',
        messages: [{ role: 'user', content: 'private' }],
      }),
    ).rejects.toThrow()
    expect(escaped).toBe(false)
  } finally {
    redirect.stop(true)
    target.stop(true)
  }
})
