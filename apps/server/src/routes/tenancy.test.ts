import { expect, test } from 'bun:test'
import { silentLogger } from '@closer/core'
import { buildApp } from '../app.ts'
import type { Config } from '../config.ts'
import type { ServerDeps } from '../deps.ts'
import {
  FixedClock,
  MemoryEventStore,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
} from '../../../cli/src/testing/fakes.ts'
import { ANSWER, EXTRACTION, RESUME, judged, ANSWER_QUOTE } from '../testing/harness.ts'

const CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  CLOSER_EVENT_DIR: '.closer/events',
  CLOSER_EXPORT_DIR: '.closer/exports',
  CLOSER_STORE: 'jsonl',
  SESSION_TOKEN_CEILING: 120_000,
  SESSION_COST_CEILING_USD: 2,
  MODEL_CALLS_PER_TURN_CEILING: 3,
  CLOSER_API_TOKENS: 'alice:alice-token,bob:bob-token',
  CLOSER_CORS_ORIGIN: '',
  CLOSER_RATE_LIMIT_PER_MINUTE: 10_000,
  CLOSER_MAX_BODY_BYTES: 262_144,
  CLOSER_DEMO_MODE: false,
  CLOSER_WEB_DIST: 'apps/web/dist-does-not-exist',
  SNAPSHOT_RETENTION_DAYS: 90,
  OTEL_ENABLED: false,
}

async function twoOwnerApp() {
  const stores = new Map<string, MemoryEventStore>()
  const deps: ServerDeps = {
    storeFor: (owner) => {
      const ownerId = typeof owner === 'string' ? owner : owner.ownerId
      const known = stores.get(ownerId) ?? new MemoryEventStore()
      stores.set(ownerId, known)
      return known
    },
    clock: new FixedClock(),
    ids: new SeqIds(),
    conductor: new ScriptedConductor(['what breaks first?', 'and then?']),
    evaluator: new ScriptedEvaluator([EXTRACTION, judged(ANSWER_QUOTE), judged(ANSWER_QUOTE)]),
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    logger: silentLogger,
    queue: null,
    retrieval: null,
  }
  const app = await buildApp(CONFIG, deps)
  await app.ready()
  return { app, stores }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

test('a request with no token is refused once tokens are configured', async () => {
  const { app } = await twoOwnerApp()

  const response = await app.inject({ method: 'GET', url: '/ledger' })
  expect(response.statusCode).toBe(401)
  await app.close()
})

test('health and metrics stay reachable without a token', async () => {
  const { app } = await twoOwnerApp()

  expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(200)
  await app.close()
})

// PROJECT.md §7: one user's artifacts are never exposed to another. This is that, end to end.
test('one owner never sees another owner’s claims, sessions or ledger', async () => {
  const { app } = await twoOwnerApp()

  const extracted = await app.inject({
    method: 'POST',
    url: '/claims',
    headers: bearer('alice-token'),
    payload: { resumeText: RESUME },
  })
  const claimId = (extracted.json() as { claims: { id: string }[] }).claims[0]?.id as string
  await app.inject({
    method: 'POST',
    url: `/claims/${claimId}/confirm`,
    headers: bearer('alice-token'),
    payload: { confirmed: true },
  })

  const started = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: bearer('alice-token'),
    payload: { mode: 'coach', turnsPerRound: 1, drill: false },
  })
  expect(started.statusCode).toBe(201)
  const sessionId = (started.json() as { sessionId: string }).sessionId

  // Bob has confirmed nothing, so his own claim set is empty rather than Alice's.
  const bobStarts = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: bearer('bob-token'),
    payload: {},
  })
  expect(bobStarts.statusCode).toBe(409)

  const bobReads = await app.inject({
    method: 'GET',
    url: `/sessions/${sessionId}`,
    headers: bearer('bob-token'),
  })
  expect(bobReads.statusCode).toBe(404)

  const bobAnswers = await app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/answers`,
    headers: bearer('bob-token'),
    payload: { text: ANSWER },
  })
  // Not a 403: confirming that someone else's session exists is itself a disclosure.
  expect(bobAnswers.statusCode).toBe(404)

  const bobLedger = await app.inject({
    method: 'GET',
    url: '/ledger',
    headers: bearer('bob-token'),
  })
  expect((bobLedger.json() as { gaps: unknown[] }).gaps).toEqual([])

  const aliceReads = await app.inject({
    method: 'GET',
    url: `/sessions/${sessionId}`,
    headers: bearer('alice-token'),
  })
  expect(aliceReads.statusCode).toBe(200)
  await app.close()
})

test('an export contains only the requesting owner’s sessions', async () => {
  const { app } = await twoOwnerApp()

  await app.inject({
    method: 'POST',
    url: '/claims',
    headers: bearer('alice-token'),
    payload: { resumeText: RESUME },
  })

  const bob = await app.inject({ method: 'GET', url: '/export', headers: bearer('bob-token') })
  expect(bob.statusCode).toBe(200)
  const bundle = bob.json() as { ownerId: string; sessions: unknown[] }
  expect(bundle.ownerId).toBe('bob')
  expect(bundle.sessions).toEqual([])
  await app.close()
})
