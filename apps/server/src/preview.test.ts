import { expect, test } from 'bun:test'
import { testApi } from './testing/harness.ts'

test('read-only preview keeps catalogs and visitor identity but refuses mutations before parsing', async () => {
  const { app } = await testApi({
    config: { LEVELHEAD_PREVIEW_MODE: true, LEVELHEAD_DEMO_MODE: true },
  })
  try {
    expect((await app.inject({ method: 'GET', url: '/roles' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/demo/token' })).statusCode).toBe(201)
    for (const url of ['/sessions', '/claims', '/snapshots', '/mirror']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        payload: '{invalid json',
      })
      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('read-only UI preview')
    }
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      expect((await app.inject({ method, url: '/sessions/example' })).statusCode).toBe(503)
    }
  } finally {
    await app.close()
  }
})

test('preview does not enable demo identities when demo mode is off', async () => {
  const { app } = await testApi({ config: { LEVELHEAD_PREVIEW_MODE: true } })
  try {
    expect((await app.inject({ method: 'POST', url: '/demo/token' })).statusCode).toBe(503)
  } finally {
    await app.close()
  }
})

test('normal mode still creates sessions instead of rejecting as a preview', async () => {
  const { app } = await testApi()
  try {
    expect((await app.inject({ method: 'POST', url: '/sessions', payload: {} })).statusCode).toBe(
      201,
    )
  } finally {
    await app.close()
  }
})
