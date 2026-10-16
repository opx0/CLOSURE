import { test, expect } from 'bun:test'
import { testApi } from './testing/harness.ts'

test('health still answers, and the OpenAPI document still generates', async () => {
  const { app } = await testApi()

  const health = await app.inject({ method: 'GET', url: '/health' })
  expect(health.statusCode).toBe(200)
  expect((health.json() as { status: string }).status).toBe('ok')

  const document = await app.inject({ method: 'GET', url: '/openapi.json' })
  expect(document.statusCode).toBe(200)
})

test('every route is in the generated document, because the schemas are the contract', async () => {
  const { app } = await testApi()
  const document = await app.inject({ method: 'GET', url: '/openapi.json' })
  const paths = Object.keys((document.json() as { paths: Record<string, unknown> }).paths)

  expect(paths).toEqual(
    expect.arrayContaining([
      '/health',
      '/claims',
      '/claims/{id}/confirm',
      '/sessions',
      '/sessions/{id}',
      '/sessions/{id}/answers',
      '/sessions/{id}/events',
      '/sessions/{id}/replay',
      '/ledger',
      '/topics',
      '/snapshots',
      '/snapshots/{id}/artifacts/{artifactId}',
      '/resume/feedback',
    ]),
  )
})

// Complements `tests/invariants/no-aggregate-score.test.ts`, which greps the source — this checks
// the generated document instead, where a dashboard-shaped field would actually surface.
test('no field anywhere in the API is an aggregate score', async () => {
  const { app } = await testApi()
  const document = await app.inject({ method: 'GET', url: '/openapi.json' })
  const banned = /^(readiness|overall|composite|aggregate|total)_?[Ss]core$|^score(Percent|Pct)$/

  const offenders: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (banned.test(key)) offenders.push(`${path}.${key}`)
      walk(child, `${path}.${key}`)
    }
  }
  walk(document.json(), 'openapi')

  expect(offenders).toEqual([])
})
