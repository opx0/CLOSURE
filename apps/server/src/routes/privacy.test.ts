import { expect, test } from 'bun:test'
import { interviewed, testApi } from '../testing/harness.ts'
import { ANSWER_QUOTE, EXTRACTION, judged } from '../testing/harness.ts'

function scripted() {
  return {
    questions: ['walk me through how a job is claimed'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  }
}

test('the export carries the raw events, not a summary of them', async () => {
  const { app } = await testApi(scripted())
  await interviewed(app)

  const response = await app.inject({ method: 'GET', url: '/export' })
  expect(response.statusCode).toBe(200)

  const bundle = response.json() as {
    formatVersion: number
    sessions: { events: unknown[]; findings: unknown[]; transcript: unknown[] }[]
  }
  expect(bundle.formatVersion).toBe(1)
  const withFindings = bundle.sessions.find((session) => session.findings.length > 0)
  expect(withFindings?.events.length).toBeGreaterThan(0)
  expect(withFindings?.transcript.length).toBeGreaterThan(0)
})

test('the retention promises are served, not left to a README nobody reads', async () => {
  const { app } = await testApi(scripted())

  const response = await app.inject({ method: 'GET', url: '/privacy' })
  const promises = response.json() as Record<string, string>

  expect(promises['replayAfterDeletion']).toContain('snapshot_deleted')
  expect(promises['logs']).toContain('never appear')
})

test('deleting a snapshot nobody pinned is a 404, not a silent success', async () => {
  const { app } = await testApi(scripted())

  const response = await app.inject({ method: 'DELETE', url: '/snapshots/snapshot_missing' })
  expect(response.statusCode).toBe(404)
})
