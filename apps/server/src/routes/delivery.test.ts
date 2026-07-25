import { expect, test } from 'bun:test'
import { ANSWER_QUOTE, EXTRACTION, interviewed, judged, testApi } from '../testing/harness.ts'

function scripted() {
  return {
    questions: ['walk me through how a job is claimed', 'and what breaks?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE), judged(ANSWER_QUOTE)],
  }
}

test('delivery is recorded against a real attempt and reads back from the log', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const view = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  const attemptId = (view.json() as { transcript: { attemptId: string }[] }).transcript[0]
    ?.attemptId as string

  const recorded = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/delivery`,
    payload: {
      attemptId,
      transcript: 'um, we leased each job, you know, for thirty seconds',
      audioMs: 5_000,
      pauses: [{ atMs: 1_000, durationMs: 2_000 }],
    },
  })

  expect(recorded.statusCode).toBe(201)
  const body = recorded.json() as { report: Record<string, unknown>; boundary: string }
  expect(body.report['longPauseCount']).toBe(1)
  expect(body.boundary).toContain('nothing about whether the answer was any good')

  const read = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/delivery` })
  expect((read.json() as { reports: unknown[] }).reports).toHaveLength(1)
})

// Delivery is never competence. It has no verdict, no confidence, and it never reaches the
// findings or the gap ledger — this is the check that keeps that true as the API grows.
test('a delivery report never becomes a finding or a gap', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const view = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  const before = view.json() as { findings: unknown[]; gaps: unknown[] }
  const attemptId = (view.json() as { transcript: { attemptId: string }[] }).transcript[0]
    ?.attemptId as string

  await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/delivery`,
    payload: { attemptId, transcript: 'um um um', audioMs: 3_000, pauses: [] },
  })

  const after = (
    await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  ).json() as { findings: unknown[]; gaps: unknown[] }

  expect(after.findings).toEqual(before.findings)
  expect(after.gaps).toEqual(before.gaps)
})

test('delivery for an attempt in another session is refused', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const response = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/delivery`,
    payload: { attemptId: 'att_not_here', transcript: 'hello', audioMs: 1_000, pauses: [] },
  })
  expect(response.statusCode).toBe(404)
})
