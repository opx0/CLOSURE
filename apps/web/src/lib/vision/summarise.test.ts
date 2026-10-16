/// <reference types="bun" />
import { test, expect } from 'bun:test'
import { summariseFrames } from './summarise.ts'
import type { FaceSample, FrameSample, Point } from './types.ts'

function face(overrides: Partial<FaceSample> = {}): FaceSample {
  return {
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    lensAngleDeg: 0,
    boxTopY: 0.1,
    boxCenterX: 0.5,
    ...overrides,
  }
}

function frame(index: number, overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    tMs: index * 100,
    face: null,
    shoulderMid: null,
    leftHand: null,
    rightHand: null,
    exposure: { luminanceMedian: 0.5, clippedRatio: 0 },
    ...overrides,
  }
}

const point = (x: number, y: number): Point => ({ x, y })

test('gaze cone, face visibility and head pose variance over a run with a face in five of eight', () => {
  const lens = [2, 10, 14.9, 20, 45]
  const yaw = [0, 10, 20, 30, 40]
  const roll = [0, 0, 6, 0, 0]
  const samples = [
    ...lens.map((lensAngleDeg, at) =>
      frame(at, {
        face: face({ lensAngleDeg, yawDeg: yaw[at] ?? 0, pitchDeg: 1, rollDeg: roll[at] ?? 0 }),
      }),
    ),
    frame(5),
    frame(6),
    frame(7),
  ]

  const report = summariseFrames('a1', samples, 800)

  expect(report.attemptId).toBe('a1')
  expect(report.boundary).toBe('observation_only_never_competence')
  expect(report.observedMs).toBe(800)
  expect(report.framesObserved).toBe(8)
  expect(report.framesWithFace).toBe(5)
  expect(report.faceVisibleRatio).toBe(0.625)
  expect(report.gazeOnCameraRatio).toBe(0.6)
  expect(report.headPose.yawDegreesSquared).toBe(200)
  expect(report.headPose.pitchDegreesSquared).toBe(0)
  expect(report.headPose.rollDegreesSquared).toBeCloseTo(5.76, 10)
  expect(report.framing.headroom).toBe(0.1)
  expect(report.framing.centerOffset).toBe(0)
  expect(report.framing.exposureMedian).toBe(0.5)
  expect(report.framing.exposureClippedRatio).toBe(0)
  expect(report.gesture.handsOutOfFrameRatio).toBe(1)
  expect(report.postureShiftsPerMinute).toBe(0)
  expect(report.gesture.ratePerMinute).toBe(0)
  expect(report.gesture.medianAmplitude).toBe(0)
})

test('three of six shoulder moves exceed the shift threshold over one minute', () => {
  const midpoints = [
    point(0.5, 0.6),
    point(0.5, 0.6),
    point(0.56, 0.6),
    point(0.56, 0.6),
    point(0.56, 0.68),
    point(0.57, 0.68),
    point(0.5, 0.6),
  ]
  const samples = midpoints.map((shoulderMid, at) => frame(at, { shoulderMid }))

  expect(summariseFrames('a2', samples, 60_000).postureShiftsPerMinute).toBe(3)
})

test('a 0.4 gap across a dropped shoulder detection is not a shift', () => {
  const samples = [
    frame(0, { shoulderMid: point(0.5, 0.5) }),
    frame(1),
    frame(2, { shoulderMid: point(0.9, 0.5) }),
    frame(3, { shoulderMid: point(0.9, 0.5) }),
  ]

  expect(summariseFrames('a3', samples, 60_000).postureShiftsPerMinute).toBe(0)
})

test('two runs of right-hand movement are two gestures with their own amplitudes', () => {
  const xs = [0.3, 0.3, 0.4, 0.5, 0.5, 0.55, 0.55]
  const samples = xs.map((x, at) => frame(at, { rightHand: { x, y: 0.5, inFrame: true } }))

  const { gesture } = summariseFrames('a4', samples, 60_000)

  expect(gesture.ratePerMinute).toBe(2)
  expect(gesture.medianAmplitude).toBeCloseTo(0.125, 10)
  expect(gesture.handsOutOfFrameRatio).toBe(0)
})

test('a hand tracked past the edge counts as out of frame and contributes no gesture', () => {
  const samples = [
    frame(0, { rightHand: { x: 0.4, y: 0.5, inFrame: true } }),
    frame(1, { rightHand: { x: 1.3, y: 0.5, inFrame: false } }),
    frame(2),
    frame(3, { leftHand: { x: -0.2, y: 0.5, inFrame: false } }),
  ]

  const { gesture } = summariseFrames('a5', samples, 1_000)

  expect(gesture.handsOutOfFrameRatio).toBe(0.75)
  expect(gesture.ratePerMinute).toBe(0)
  expect(gesture.medianAmplitude).toBe(0)
})

test('framing takes the middle value of an odd run', () => {
  const tops = [0.1, 0.12, 0.14, 0.16, 0.18]
  const centers = [0.5, 0.52, 0.54, 0.56, 0.58]
  const luminance = [0.3, 0.4, 0.5, 0.6, 0.7]
  const clipped = [0, 0.01, 0.02, 0.03, 0.1]
  const samples = tops.map((boxTopY, at) =>
    frame(at, {
      face: face({ boxTopY, boxCenterX: centers[at] ?? 0 }),
      exposure: { luminanceMedian: luminance[at] ?? 0, clippedRatio: clipped[at] ?? 0 },
    }),
  )

  const { framing } = summariseFrames('a6', samples, 500)

  expect(framing.headroom).toBe(0.14)
  expect(framing.centerOffset).toBeCloseTo(0.04, 10)
  expect(framing.exposureMedian).toBe(0.5)
  expect(framing.exposureClippedRatio).toBe(0.02)
})

test('framing averages the two middle values of an even run', () => {
  const samples = [0.1, 0.2, 0.3, 0.4].map((boxTopY, at) => frame(at, { face: face({ boxTopY }) }))

  expect(summariseFrames('a7', samples, 400).framing.headroom).toBeCloseTo(0.25, 10)
})

test('an empty run reports zero everywhere and keeps its labels', () => {
  expect(summariseFrames('attempt-empty', [], 0)).toEqual({
    attemptId: 'attempt-empty',
    observedMs: 0,
    framesObserved: 0,
    framesWithFace: 0,
    faceVisibleRatio: 0,
    gazeOnCameraRatio: 0,
    headPose: { yawDegreesSquared: 0, pitchDegreesSquared: 0, rollDegreesSquared: 0 },
    postureShiftsPerMinute: 0,
    gesture: { ratePerMinute: 0, medianAmplitude: 0, handsOutOfFrameRatio: 0 },
    framing: { headroom: 0, centerOffset: 0, exposureMedian: 0, exposureClippedRatio: 0 },
    boundary: 'observation_only_never_competence',
  })
})

test('a run with no face still measures exposure and reports nothing about the head', () => {
  const samples = [0.2, 0.2, 0.4, 0.4].map((luminanceMedian, at) =>
    frame(at, { exposure: { luminanceMedian, clippedRatio: 0 } }),
  )

  const report = summariseFrames('a9', samples, 400)

  expect(report.framesObserved).toBe(4)
  expect(report.framesWithFace).toBe(0)
  expect(report.faceVisibleRatio).toBe(0)
  expect(report.gazeOnCameraRatio).toBe(0)
  expect(report.headPose).toEqual({
    yawDegreesSquared: 0,
    pitchDegreesSquared: 0,
    rollDegreesSquared: 0,
  })
  expect(report.framing.headroom).toBe(0)
  expect(report.framing.centerOffset).toBe(0)
  expect(report.framing.exposureMedian).toBeCloseTo(0.3, 10)
  expect(report.framing.exposureClippedRatio).toBe(0)
  expect(report.gesture.handsOutOfFrameRatio).toBe(1)
  expect(report.gesture.ratePerMinute).toBe(0)
  expect(report.gesture.medianAmplitude).toBe(0)
  expect(report.postureShiftsPerMinute).toBe(0)
})

// The cone is inclusive at its edge. Without a sample sitting exactly on it, `<=` could drift to
// `<` and the only visible effect would be a slightly lower ratio on every session ever recorded.
test('a head exactly on the edge of the cone counts as facing the camera', () => {
  const samples = [
    frame(0, { face: face({ lensAngleDeg: 15 }) }),
    frame(1, { face: face({ lensAngleDeg: 15.1 }) }),
  ]

  expect(summariseFrames('edge', samples, 200).gazeOnCameraRatio).toBe(0.5)
})
