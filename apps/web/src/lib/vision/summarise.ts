import type { KinematicsReport } from '@levelhead/contracts'
import type { FrameSample, HandSample, Point } from './types.ts'

// A head vector within this many degrees of the lens axis counts as facing the camera. At a 60 cm
// viewing distance a 14-inch laptop screen spans about 31 cm, so its half-width subtends about
// 14.5 degrees; a 15 degree cone is "the head is pointed somewhere at the screen". This is "facing
// the camera" and is never "paying attention" or "making eye contact".
const GAZE_CONE_DEG = 15

// Shoulder-midpoint displacement between consecutive samples, in normalised frame widths, above
// which the body counts as having shifted. Samples are about 100 ms apart, and 4% of frame width is
// several times the pose tracker's resting jitter while still being smaller than a deliberate lean.
const POSTURE_SHIFT = 0.04

// Hand displacement between consecutive samples, in normalised frame widths, above which the hand
// counts as moving. Below it the hand tracker's own jitter between two frames would read as motion.
const GESTURE_SPEED = 0.03

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

// Population variance, dividing by n rather than n - 1: the samples are the whole observed run,
// not a draw from a larger one.
function variance(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}

function perMinute(count: number, observedMs: number): number {
  return observedMs === 0 ? 0 : count / (observedMs / 60_000)
}

function heldInFrame(hand: HandSample | null): Point | null {
  return hand !== null && hand.inFrame ? hand : null
}

// Consecutive pairs where both positions are known. A pair with a missing side is skipped, never
// treated as a jump: a dropped detection is not a movement.
function countShifts(series: readonly (Point | null)[]): number {
  let shifts = 0
  for (let at = 1; at < series.length; at += 1) {
    const from = series[at - 1]
    const to = series[at]
    if (from && to && distance(from, to) > POSTURE_SHIFT) shifts += 1
  }
  return shifts
}

// One hand's positions in sample order. A maximal run of consecutive moving steps is one gesture,
// and its amplitude is how far the hand got from where the run began.
function gestureAmplitudes(series: readonly (Point | null)[]): number[] {
  const amplitudes: number[] = []
  let origin: Point | null = null
  let reach = 0
  const close = (): void => {
    if (origin) amplitudes.push(reach)
    origin = null
    reach = 0
  }
  for (let at = 1; at < series.length; at += 1) {
    const from = series[at - 1]
    const to = series[at]
    if (!from || !to || distance(from, to) <= GESTURE_SPEED) {
      close()
      continue
    }
    origin ??= from
    reach = Math.max(reach, distance(origin, to))
  }
  close()
  return amplitudes
}

export function summariseFrames(
  attemptId: string,
  samples: readonly FrameSample[],
  observedMs: number,
): KinematicsReport {
  const faces = samples.flatMap((sample) => (sample.face ? [sample.face] : []))
  const leftHands = samples.map((sample) => heldInFrame(sample.leftHand))
  const rightHands = samples.map((sample) => heldInFrame(sample.rightHand))
  const amplitudes = [...gestureAmplitudes(leftHands), ...gestureAmplitudes(rightHands)]
  const handsOutOfFrame = samples.filter(
    (_, at) => leftHands[at] === null && rightHands[at] === null,
  ).length

  return {
    attemptId,
    observedMs: Math.round(observedMs),
    framesObserved: samples.length,
    framesWithFace: faces.length,
    faceVisibleRatio: ratio(faces.length, samples.length),
    // Over the frames with a face, not all frames: with no face there is nothing to say about
    // which way a head pointed, and counting those frames as "away" would invent a direction.
    gazeOnCameraRatio: ratio(
      faces.filter((face) => face.lensAngleDeg <= GAZE_CONE_DEG).length,
      faces.length,
    ),
    headPose: {
      yawDegreesSquared: variance(faces.map((face) => face.yawDeg)),
      pitchDegreesSquared: variance(faces.map((face) => face.pitchDeg)),
      rollDegreesSquared: variance(faces.map((face) => face.rollDeg)),
    },
    postureShiftsPerMinute: perMinute(
      countShifts(samples.map((sample) => sample.shoulderMid)),
      observedMs,
    ),
    gesture: {
      ratePerMinute: perMinute(amplitudes.length, observedMs),
      medianAmplitude: median(amplitudes),
      handsOutOfFrameRatio: ratio(handsOutOfFrame, samples.length),
    },
    framing: {
      // Left signed so a cropped crown reads negative.
      headroom: median(faces.map((face) => face.boxTopY)),
      centerOffset: faces.length === 0 ? 0 : median(faces.map((face) => face.boxCenterX)) - 0.5,
      // Medians rather than means: one flash or one blown frame should not redefine the shot.
      exposureMedian: median(samples.map((sample) => sample.exposure.luminanceMedian)),
      exposureClippedRatio: median(samples.map((sample) => sample.exposure.clippedRatio)),
    },
    boundary: 'observation_only_never_competence',
  }
}
