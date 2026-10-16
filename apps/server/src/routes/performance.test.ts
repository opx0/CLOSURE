import { expect, test } from 'bun:test'
import { PERFORMANCE_BOUNDARY } from '@levelhead/contracts'
import type { KinematicsReport, ProsodyReport } from '@levelhead/contracts'
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

async function firstAttemptId(app: Awaited<ReturnType<typeof testApi>>['app'], sessionId: string) {
  const view = await app.inject({ method: 'GET', url: `/sessions/${sessionId}` })
  const attemptId = (view.json() as { transcript: { attemptId: string }[] }).transcript[0]
    ?.attemptId
  if (attemptId === undefined) throw new Error('no attempt in the interviewed session')
  return attemptId
}

test('prosody and kinematics are recorded against a real attempt and read back from /performance', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)
  const attemptId = await firstAttemptId(app, start.sessionId)

  const recorded = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/prosody`,
    payload: prosody(attemptId),
  })
  expect(recorded.statusCode).toBe(201)
  const body = recorded.json() as { report: { attemptId: string }; boundary: string }
  expect(body.report.attemptId).toBe(attemptId)
  expect(body.boundary).toContain('say nothing about whether the answer was any good')

  const kine = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/kinematics`,
    payload: kinematics(attemptId),
  })
  expect(kine.statusCode).toBe(201)
  expect((kine.json() as { boundary: string }).boundary).toContain('never an expression')

  const read = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/performance` })
  const performance = read.json() as {
    prosody: { attemptId: string }[]
    kinematics: { attemptId: string }[]
  }
  expect(performance.prosody).toHaveLength(1)
  expect(performance.kinematics).toHaveLength(1)
  expect(performance.prosody[0]?.attemptId).toBe(attemptId)
  expect(performance.kinematics[0]?.attemptId).toBe(attemptId)
})

// The whole point of the lane: an observation is never competence. Recording it must not disturb the
// findings or the gap ledger, and this is the check that keeps that true as the API grows.
test('recording prosody or kinematics changes neither findings nor gaps', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)
  const attemptId = await firstAttemptId(app, start.sessionId)

  const before = (
    await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  ).json() as {
    findings: unknown[]
    gaps: unknown[]
  }

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

  const after = (
    await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  ).json() as {
    findings: unknown[]
    gaps: unknown[]
  }

  expect(after.findings).toEqual(before.findings)
  expect(after.gaps).toEqual(before.gaps)
})

test('prosody for an attempt in another session is refused', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const response = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/prosody`,
    payload: prosody('att_not_here'),
  })
  expect(response.statusCode).toBe(404)
})

test('performance for an unknown session is 404', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'GET', url: '/sessions/nope/performance' })
  expect(response.statusCode).toBe(404)
})
