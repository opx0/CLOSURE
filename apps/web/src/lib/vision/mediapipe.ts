import type { KinematicsReport } from '@levelhead/contracts'
import { headAnglesFromMatrix } from './head-pose.ts'
import { summariseFrames } from './summarise.ts'
import type { ExposureSample, FaceSample, FrameSample, HandSample, Point } from './types.ts'

// Vision is an extra instrument and never a gate. When it cannot start, the caller catches the
// message, shows it, and the session continues in audio and text.

// Pinned rather than floating: a `latest` that moves under a running session would change what the
// numbers mean mid-interview, and there is no lockfile entry to protect it because the package is
// deliberately not a dependency.
const MEDIAPIPE_VERSION = '1.0.1'
const MEDIAPIPE_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// 10 Hz is fast enough to catch a posture shift or a gesture and slow enough that three landmarkers
// keep up on a laptop CPU.
const SAMPLE_INTERVAL_MS = 100

// Indices from the documented 33-point BlazePose topology.
const POSE_LEFT_SHOULDER = 11
const POSE_RIGHT_SHOULDER = 12

// A median and a clipped-pixel count over 2304 samples is stable, and it costs almost nothing per
// frame.
const SCRATCH_WIDTH = 64
const SCRATCH_HEIGHT = 36

// Crushed or blown out: at or below the first, at or above the second, the sensor has nothing left
// to say about that pixel.
const CRUSHED_AT_OR_BELOW = 2
const BLOWN_AT_OR_ABOVE = 253

interface Landmark {
  readonly x: number
  readonly y: number
}

interface FaceResult {
  readonly faceLandmarks: readonly (readonly Landmark[])[]
  readonly facialTransformationMatrixes: readonly { readonly data: readonly number[] }[]
}

interface PoseResult {
  readonly landmarks: readonly (readonly Landmark[])[]
}

interface HandResult {
  readonly landmarks: readonly (readonly Landmark[])[]
  readonly handedness: readonly (readonly { readonly categoryName: string }[])[]
}

interface Detector<Result> {
  detectForVideo(frame: HTMLVideoElement, timestampMs: number): Result
  close(): void
}

interface TaskOptions {
  readonly baseOptions: { readonly modelAssetPath: string; readonly delegate: 'CPU' | 'GPU' }
  readonly runningMode: 'IMAGE' | 'VIDEO'
}

interface FaceOptions extends TaskOptions {
  readonly numFaces: number
  readonly outputFacialTransformationMatrixes: boolean
}

interface PoseOptions extends TaskOptions {
  readonly numPoses: number
}

interface HandOptions extends TaskOptions {
  readonly numHands: number
}

type WasmFileset = object

interface TaskFactory<Options, Result> {
  createFromOptions(fileset: WasmFileset, options: Options): Promise<Detector<Result>>
}

interface VisionModule {
  readonly FilesetResolver: { forVisionTasks(basePath: string): Promise<WasmFileset> }
  readonly FaceLandmarker: TaskFactory<FaceOptions, FaceResult>
  readonly PoseLandmarker: TaskFactory<PoseOptions, PoseResult>
  readonly HandLandmarker: TaskFactory<HandOptions, HandResult>
}

interface Detectors {
  readonly face: Detector<FaceResult>
  readonly pose: Detector<PoseResult>
  readonly hand: Detector<HandResult>
}

export interface KinematicsCapture {
  stop(): Promise<KinematicsReport>
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadDetectors(): Promise<Detectors> {
  const src = MEDIAPIPE_BUNDLE_URL
  // The one place this module trusts an untyped import.
  const vision = (await import(/* @vite-ignore */ src)) as unknown as VisionModule
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL)
  const [face, pose, hand] = await Promise.all([
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      // One interview, one candidate.
      numFaces: 1,
      // The transformation matrix is the only thing head angles can be derived from.
      outputFacialTransformationMatrixes: true,
    }),
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      // One candidate.
      numPoses: 1,
    }),
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      // Two hands.
      numHands: 2,
    }),
  ])
  return { face, pose, hand }
}

async function prepareVideo(
  source: MediaStream | HTMLVideoElement,
): Promise<{ video: HTMLVideoElement; created: boolean }> {
  if (source instanceof HTMLVideoElement) return { video: source, created: false }
  const video = document.createElement('video')
  video.srcObject = source
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  await video.play()
  return { video, created: true }
}

function reduceFace(result: FaceResult): FaceSample | null {
  const points = result.faceLandmarks[0]
  const matrix = result.facialTransformationMatrixes[0]
  if (points === undefined || points.length === 0 || matrix === undefined) return null
  const angles = headAnglesFromMatrix(matrix.data)
  if (angles === null) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
  }
  return {
    yawDeg: angles.yawDeg,
    pitchDeg: angles.pitchDeg,
    rollDeg: angles.rollDeg,
    lensAngleDeg: angles.lensAngleDeg,
    boxTopY: minY,
    boxCenterX: (minX + maxX) / 2,
  }
}

function reduceShoulders(result: PoseResult): Point | null {
  const left = result.landmarks[0]?.[POSE_LEFT_SHOULDER]
  const right = result.landmarks[0]?.[POSE_RIGHT_SHOULDER]
  if (left === undefined || right === undefined) return null
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

function reduceHands(result: HandResult): {
  left: HandSample | null
  right: HandSample | null
} {
  let left: HandSample | null = null
  let right: HandSample | null = null
  for (const [index, points] of result.landmarks.entries()) {
    const wrist = points[0]
    const side = result.handedness[index]?.[0]?.categoryName
    if (wrist === undefined || side === undefined) continue
    const sample: HandSample = {
      x: wrist.x,
      y: wrist.y,
      inFrame: wrist.x >= 0 && wrist.x <= 1 && wrist.y >= 0 && wrist.y <= 1,
    }
    // MediaPipe's handedness is from the image's point of view and is mirrored on a selfie camera.
    // That does not matter here: all that is needed is a side label that stays stable across frames.
    if (side === 'Left') left = sample
    else if (side === 'Right') right = sample
  }
  return { left, right }
}

function medianFromHistogram(histogram: Uint32Array, count: number): number {
  const lowerMiddle = Math.floor((count - 1) / 2)
  const upperMiddle = Math.floor(count / 2)
  let seen = 0
  let lowerValue = -1
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value] ?? 0
    if (lowerValue < 0 && seen > lowerMiddle) lowerValue = value
    if (seen > upperMiddle) return (lowerValue + value) / 2
  }
  return 0
}

function readExposure(
  context: CanvasRenderingContext2D | null,
  video: HTMLVideoElement,
): ExposureSample {
  if (context === null) return { luminanceMedian: 0, clippedRatio: 0 }
  let pixels: Uint8ClampedArray
  try {
    context.drawImage(video, 0, 0, SCRATCH_WIDTH, SCRATCH_HEIGHT)
    pixels = context.getImageData(0, 0, SCRATCH_WIDTH, SCRATCH_HEIGHT).data
  } catch {
    return { luminanceMedian: 0, clippedRatio: 0 }
  }

  const histogram = new Uint32Array(256)
  let clipped = 0
  for (let at = 0; at < pixels.length; at += 4) {
    // Rec. 709 luma coefficients.
    const luma = Math.round(
      0.2126 * (pixels[at] ?? 0) + 0.7152 * (pixels[at + 1] ?? 0) + 0.0722 * (pixels[at + 2] ?? 0),
    )
    histogram[luma] = (histogram[luma] ?? 0) + 1
    if (luma <= CRUSHED_AT_OR_BELOW || luma >= BLOWN_AT_OR_ABOVE) clipped += 1
  }
  const count = pixels.length / 4
  return {
    luminanceMedian: medianFromHistogram(histogram, count) / 255,
    clippedRatio: clipped / count,
  }
}

function quietly(action: () => void): void {
  try {
    action()
  } catch {
    // Teardown never outranks the report.
  }
}

export async function startKinematicsCapture(
  attemptId: string,
  source: MediaStream | HTMLVideoElement,
): Promise<KinematicsCapture> {
  let detectors: Detectors
  try {
    detectors = await loadDetectors()
  } catch (error) {
    throw new Error(`the vision models did not load: ${describe(error)}`, { cause: error })
  }

  let video: HTMLVideoElement
  let created: boolean
  try {
    ;({ video, created } = await prepareVideo(source))
  } catch (error) {
    quietly(() => detectors.face.close())
    quietly(() => detectors.pose.close())
    quietly(() => detectors.hand.close())
    throw new Error(`the camera video did not play: ${describe(error)}`, { cause: error })
  }

  const scratch = document.createElement('canvas')
  scratch.width = SCRATCH_WIDTH
  scratch.height = SCRATCH_HEIGHT
  const context = scratch.getContext('2d', { willReadFrequently: true })

  let samples: FrameSample[] = []
  let report: KinematicsReport | null = null
  let stopped = false
  let pending: ReturnType<typeof setTimeout> | null = null
  // VIDEO mode rejects a timestamp that does not strictly exceed the previous one. Browsers coarsen
  // `performance.now()` and two samples can land in the same millisecond, so the loop keeps its own
  // timeline and hands the one value to all three detectors.
  let timelineMs = 0

  const startedAt = performance.now()
  const sample = () => {
    if (stopped) return
    if (video.videoWidth !== 0) {
      timelineMs += SAMPLE_INTERVAL_MS
      try {
        const face = detectors.face.detectForVideo(video, timelineMs)
        const pose = detectors.pose.detectForVideo(video, timelineMs)
        const hands = reduceHands(detectors.hand.detectForVideo(video, timelineMs))
        samples.push({
          tMs: performance.now() - startedAt,
          face: reduceFace(face),
          shoulderMid: reduceShoulders(pose),
          leftHand: hands.left,
          rightHand: hands.right,
          exposure: readExposure(context, video),
        })
      } catch {
        // One bad frame is not a reason to lose the rest of the session.
      }
    }
    if (!stopped) pending = setTimeout(sample, SAMPLE_INTERVAL_MS)
  }
  sample()

  return {
    async stop() {
      if (report !== null) return report
      stopped = true
      if (pending !== null) clearTimeout(pending)
      quietly(() => detectors.face.close())
      quietly(() => detectors.pose.close())
      quietly(() => detectors.hand.close())
      // Only stop what was started here. The MediaStream belongs to the caller and its tracks keep
      // running: this module never calls `getUserMedia`, so it started no track of its own.
      if (created) {
        quietly(() => video.pause())
        video.srcObject = null
      }
      report = summariseFrames(attemptId, samples, Math.round(performance.now() - startedAt))
      samples = []
      return report
    },
  }
}
