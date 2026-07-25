import { test, expect } from 'bun:test'
import { ANSWER_QUOTE, EXTRACTION, interviewed, judged, testApi } from '../testing/harness.ts'

function scripted() {
  return {
    questions: ['How does a job get picked up, and what happens if the worker dies mid-job?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  }
}

test('a gap opened in a session shows up on the ledger, with the words behind it', async () => {
  const { app } = await testApi(scripted())
  await interviewed(app)

  const response = await app.inject({ method: 'GET', url: '/ledger' })
  expect(response.statusCode).toBe(200)

  const body = response.json() as {
    gaps: { status: string; competency: string; evidenceIds: string[] }[]
    quotes: { evidenceId: string; quoted: string }[]
    unresolvedCitations: number
  }
  expect(body.gaps).toHaveLength(1)
  // Passing a drill would not close it and neither does anything here: only transfer closes a gap.
  expect(body.gaps[0]?.status).toBe('open')
  expect(body.unresolvedCitations).toBe(0)

  const evidenceId = body.gaps[0]?.evidenceIds[0]
  expect(body.quotes.find((quote) => quote.evidenceId === evidenceId)?.quoted).toBe(ANSWER_QUOTE)
})

test('an empty ledger is an empty ledger, not an error', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'GET', url: '/ledger' })

  expect(response.statusCode).toBe(200)
  expect(
    response.json() as { gaps: unknown[]; quotes: unknown[]; unresolvedCitations: number },
  ).toEqual({ gaps: [], quotes: [], unresolvedCitations: 0 })
})

test('replay re-checks every citation and says how many it read', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const response = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/replay` })
  expect(response.statusCode).toBe(200)

  const body = response.json() as {
    spansChecked: number
    events: number
    findings: unknown[]
  }
  expect(body.spansChecked).toBeGreaterThan(0)
  expect(body.events).toBeGreaterThan(0)
  expect(body.findings).toHaveLength(1)
})

test('a citation that does not resolve fails the request rather than shading a field', async () => {
  const { app, store } = await testApi(scripted())
  const { start } = await interviewed(app)

  // Forces a corrupted span into the log — MemoryEventStore hands back its own array, so mutating
  // it here simulates a corrupted store directly.
  const events = store.sessions.get(start.sessionId) ?? []
  for (const event of events) {
    if (event.kind !== 'evaluation') continue
    const span = event.payload.spans[0]
    if (span !== undefined) span.endByte = span.endByte - 1
  }

  const response = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/replay` })
  expect(response.statusCode).toBe(500)
  const body = response.json() as { error: string; violations: { spanId: string }[] }
  expect(body.error).toBe('citations do not resolve')
  expect(body.violations.length).toBeGreaterThan(0)
})

test('replaying a session that does not exist is a 404', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'GET', url: '/sessions/ses_9999/replay' })

  expect(response.statusCode).toBe(404)
})
