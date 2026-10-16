import { expect, test } from 'bun:test'
import { DEBRIEF_WALL, PERFORMANCE_BOUNDARY } from '@levelhead/contracts'
import type { Debrief, KinematicsReport, ProsodyReport } from '@levelhead/contracts'
import { ANSWER_QUOTE, EXTRACTION, interviewed, judged, testApi } from '../testing/harness.ts'

function scripted() {
  return {
    questions: ['walk me through how a job is claimed', 'and what breaks?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE), judged(ANSWER_QUOTE)],
  }
}

function prosody(attemptId: string): ProsodyReport {
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

function kinematics(attemptId: string): KinematicsReport {
  return {
    attemptId,
    observedMs: 60_000,
    framesObserved: 1_800,
    framesWithFace: 1_710,
    faceVisibleRatio: 0.95,
    gazeOnCameraRatio: 0.8,
    headPose: { yawDegreesSquared: 12, pitchDegreesSquared: 8, rollDegreesSquared: 4 },
    postureShiftsPerMinute: 3.5,
    gesture: { ratePerMinute: 9, medianAmplitude: 0.4, handsOutOfFrameRatio: 0.1 },
    framing: {
      headroom: 0.18,
      centerOffset: 0.06,
      exposureMedian: 0.55,
      exposureClippedRatio: 0.02,
    },
    boundary: PERFORMANCE_BOUNDARY,
  }
}

test('a debrief shows a competence lane, and an empty performance lane until reports are recorded', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const before = (
    await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/debrief` })
  ).json() as Debrief

  expect(before.wall).toBe(DEBRIEF_WALL)
  // The interview produced a finding, so the competence lane is populated from the same log.
  expect(before.competence.findings.length).toBeGreaterThan(0)
  // Nothing has been recorded into the performance lane yet, so it is honestly empty.
  expect(before.performance.observations).toEqual([])
  expect(before.performance.signalsWithoutBaseline).toBe(0)
})

test('recording prosody and kinematics populates the performance lane, still with no baseline', async () => {
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
  await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/kinematics`,
    payload: kinematics(attemptId),
  })

  const debrief = (
    await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/debrief` })
  ).json() as Debrief

  expect(debrief.wall).toBe(DEBRIEF_WALL)
  expect(debrief.competence.findings.length).toBeGreaterThan(0)

  // Observations came from both recorded reports.
  const sources = new Set(debrief.performance.observations.map((o) => o.source))
  expect(sources.has('prosody')).toBe(true)
  expect(sources.has('kinematics')).toBe(true)
  for (const observation of debrief.performance.observations) {
    expect(observation.boundary).toBe(PERFORMANCE_BOUNDARY)
    expect(observation.attemptId).toBe(attemptId)
  }

  // A single session loads no history, so every measured signal is being measured for the first
  // time: no baseline, and signalsWithoutBaseline counts every distinct signal observed.
  const distinctSignals = new Set(debrief.performance.observations.map((o) => o.signal)).size
  expect(debrief.performance.baselines).toEqual([])
  expect(debrief.performance.signalsWithoutBaseline).toBe(distinctSignals)
  expect(debrief.performance.signalsWithoutBaseline).toBeGreaterThan(0)
})

test('a debrief for an unknown session is 404', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'GET', url: '/sessions/nope/debrief' })
  expect(response.statusCode).toBe(404)
})
