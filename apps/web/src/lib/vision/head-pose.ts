export interface HeadAngles {
  readonly yawDeg: number
  readonly pitchDeg: number
  readonly rollDeg: number
  readonly lensAngleDeg: number
}

const DEGREES_PER_RADIAN = 180 / Math.PI

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

// MediaPipe hands over the facial transformation matrix as sixteen numbers, a flattened 4x4 whose
// upper-left 3x3 is the rotation. Read with `m(row, col) = data[row * 4 + col]`, that block
// decomposes as R = Ry(yaw) · Rx(pitch) · Rz(roll).
export function headAnglesFromMatrix(data: readonly number[]): HeadAngles | null {
  if (data.length !== 16) return null
  const m = (row: number, col: number): number => data[row * 4 + col] ?? 0

  const pitchDeg = Math.asin(clamp(-m(1, 2), -1, 1)) * DEGREES_PER_RADIAN
  const yawDeg = Math.atan2(m(0, 2), m(2, 2)) * DEGREES_PER_RADIAN
  const rollDeg = Math.atan2(m(1, 0), m(1, 1)) * DEGREES_PER_RADIAN

  // m(2,2) equals cos(yaw)·cos(pitch), so acos(|m(2,2)|) is the single angle between where the head
  // points and the lens axis. Taking the absolute value makes it independent of whether the +Z
  // convention points out of the face or into the lens; a head turned more than 90 degrees away is
  // not detected as a face at all, so the folded branch is unreachable.
  //
  // m(2,2) sits at flat index 10 whether the array is row-major or column-major, so the lens angle
  // is identical under either reading. The yaw/pitch/roll triple is not transpose-invariant, which
  // is why it feeds only a variance in the report ("head movement"), never a claim about which way
  // someone was facing.
  const lensAngleDeg = Math.acos(clamp(Math.abs(m(2, 2)), 0, 1)) * DEGREES_PER_RADIAN

  return { yawDeg, pitchDeg, rollDeg, lensAngleDeg }
}
