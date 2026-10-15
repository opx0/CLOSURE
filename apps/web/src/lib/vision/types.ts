// One sampled frame reduced to numbers, in the browser, the instant the frame is read. Nothing here
// describes a person; it describes where a head, a pair of hands and a pair of shoulders were, and
// how bright the picture was. The frames themselves are drawn to a scratch canvas, measured, and
// dropped before the next sample.
//
// This type never leaves the module. `summariseFrames` turns a run of these into the flat
// `KinematicsReport`, and that report is the only thing a caller can hold.

// Normalised to the frame: 0 is the left or top edge, 1 the right or bottom. Positions outside that
// range are real and meaningful — a hand at x = 1.2 is out of shot to the right.
export interface Point {
  readonly x: number
  readonly y: number
}

// Angles in degrees, sign following the head's own axes. `lensAngleDeg` is the single angle between
// where the head points and where the lens is, which is what the gaze cone is measured against.
export interface FaceSample {
  readonly yawDeg: number
  readonly pitchDeg: number
  readonly rollDeg: number
  readonly lensAngleDeg: number
  readonly boxTopY: number
  readonly boxCenterX: number
}

// `inFrame` is separate from the hand being detected at all: a tracker can follow a hand past the
// edge of the shot, and "gesturing outside the frame" is the thing worth telling someone about.
export interface HandSample extends Point {
  readonly inFrame: boolean
}

export interface ExposureSample {
  readonly luminanceMedian: number
  readonly clippedRatio: number
}

// Three detectors run per frame and each can miss independently, so each observation is nullable on
// its own rather than gated behind one `faceFound` flag that the other fields would have to agree
// with. Exposure is read from the pixels, so it is present whenever the frame is.
export interface FrameSample {
  readonly tMs: number
  readonly face: FaceSample | null
  readonly shoulderMid: Point | null
  readonly leftHand: HandSample | null
  readonly rightHand: HandSample | null
  readonly exposure: ExposureSample
}
