import { Type, type Static } from '@sinclair/typebox'
import { PERFORMANCE_BOUNDARY } from './performance.ts'

// Where the body was, frame by frame, reduced to aggregates in the browser. No expression class, no
// emotion, no arousal, no engagement, no blink rate. Those are inferences about an inner state from
// a picture of a face, and CONTEXT.md forbids Levelhead to make them; invariant 9 enforces it.
//
// Raw frames never leave the browser and never reach this shape. Only these numbers travel.
export const HeadPoseVarianceSchema = Type.Object({
  yawDegreesSquared: Type.Number({ minimum: 0 }),
  pitchDegreesSquared: Type.Number({ minimum: 0 }),
  rollDegreesSquared: Type.Number({ minimum: 0 }),
})
export type HeadPoseVariance = Static<typeof HeadPoseVarianceSchema>

export const GestureTrackSchema = Type.Object({
  ratePerMinute: Type.Number({ minimum: 0 }),
  medianAmplitude: Type.Number({ minimum: 0 }),
  handsOutOfFrameRatio: Type.Number({ minimum: 0, maximum: 1 }),
})
export type GestureTrack = Static<typeof GestureTrackSchema>

// The one family of signals here that is trivially actionable and that nobody ever tells a
// candidate about: they are framed badly and lit badly, and it takes thirty seconds to fix.
export const FramingSchema = Type.Object({
  headroom: Type.Number(),
  centerOffset: Type.Number(),
  exposureMedian: Type.Number({ minimum: 0, maximum: 1 }),
  exposureClippedRatio: Type.Number({ minimum: 0, maximum: 1 }),
})
export type Framing = Static<typeof FramingSchema>

export const KinematicsReportSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  observedMs: Type.Integer({ minimum: 0 }),
  framesObserved: Type.Integer({ minimum: 0 }),
  framesWithFace: Type.Integer({ minimum: 0 }),
  faceVisibleRatio: Type.Number({ minimum: 0, maximum: 1 }),
  // A head vector inside a cone around the lens. "Facing the camera", not "making eye contact" and
  // not "paying attention".
  gazeOnCameraRatio: Type.Number({ minimum: 0, maximum: 1 }),
  headPose: HeadPoseVarianceSchema,
  postureShiftsPerMinute: Type.Number({ minimum: 0 }),
  gesture: GestureTrackSchema,
  framing: FramingSchema,
  boundary: Type.Literal(PERFORMANCE_BOUNDARY),
})
export type KinematicsReport = Static<typeof KinematicsReportSchema>
