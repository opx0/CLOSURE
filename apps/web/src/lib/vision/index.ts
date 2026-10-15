// `FrameSample` is deliberately absent. The sample type is not nameable outside the module, so no
// caller can build or hold a per-frame series, and the aggregated report is the only thing that can
// travel.
export { summariseFrames } from './summarise.ts'
export { startKinematicsCapture, type KinematicsCapture } from './mediapipe.ts'
export type { KinematicsReport } from '@levelhead/contracts'
