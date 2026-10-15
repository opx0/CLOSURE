import { expect, test } from 'bun:test'
import { PERFORMANCE_BOUNDARY } from '@levelhead/contracts'
import type { ComposureByPressure, LedgerSnapshot, PerformanceTrend } from '@levelhead/contracts'
import { ANSWER_QUOTE, EXTRACTION, interviewed, judged, testApi } from '../testing/harness.ts'

function scripted() {
  return {
    questions: ['walk me through how a job is claimed', 'and what breaks?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE), judged(ANSWER_QUOTE)],
  }
}

function prosody(attemptId: string) {
  return {
    attemptId,
    audioMs: 60_000,
    words: Array.from({ length: 60 }, (_, i) => ({
      text: `w${i}`,
      startMs: i * 900,
      endMs: i * 900 + 400,
    })),
    pauses: [
      { atMs: 5_000, durationMs: 3_000, kind: 'unfilled', position: 'mid_clause' },
      { atMs: 45_000, durationMs: 12_000, kind: 'filled', position: 'clause_boundary' },
    ],
    hesitationClusters: [{ atMs: 4_000, durationMs: 900, events: 2 }],
    disfluencies: { repairs: 3, restarts: 6, prolongations: 9, discourseMarkers: 12 },
    pitch: {
      medianHz: 118,
      p10Hz: 96,
      p90Hz: 148,
      rangeSemitones: 7.5,
      coefficientOfVariation: 0.25,
      declarativesCounted: 8,
      declarativesEndingRising: 2,
    },
    intensity: { medianDb: 62, endOfTurnDropDb: -6.5 },
    responseLatencyMs: 800,
    timeToFirstContentWordMs: 1_400,
    sentenceLengthsWords: [10, 10, 20, 20],
    boundary: PERFORMANCE_BOUNDARY,
  }
}

interface Analytics {
  performance: PerformanceTrend[]
  ledger: LedgerSnapshot[]
  composure: ComposureByPressure[]
}

test('analytics carries a performance trend once a signal was recorded, and a ledger snapshot per session', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const view = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  const attemptId = (view.json() as { transcript: { attemptId: string }[] }).transcript[0]
    ?.attemptId as string
  await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/prosody`,
    payload: prosody(attemptId),
  })

  const analytics = (await app.inject({ method: 'GET', url: '/analytics' })).json() as Analytics

  // One ledger snapshot for the one session, and it names that session.
  expect(analytics.ledger.map((row) => row.sessionId)).toEqual([start.sessionId])

  // The recorded prosody produced trends; each trend is a series of points, never one summary number.
  const articulation = analytics.performance.find((t) => t.signal === 'articulation_rate')
  expect(articulation?.boundary).toBe(PERFORMANCE_BOUNDARY)
  expect(articulation?.points.length).toBe(1)
  expect(articulation?.points[0]?.sessionId).toBe(start.sessionId)
})

test('with no session recorded, analytics is three empty series rather than a zero', async () => {
  const { app } = await testApi(scripted())

  const analytics = (await app.inject({ method: 'GET', url: '/analytics' })).json() as Analytics

  expect(analytics.performance).toEqual([])
  expect(analytics.ledger).toEqual([])
  expect(analytics.composure).toEqual([])
})
