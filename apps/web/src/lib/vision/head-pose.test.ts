/// <reference types="bun" />
import { test, expect } from 'bun:test'
import { headAnglesFromMatrix } from './head-pose.ts'

type Rotation = readonly (readonly number[])[]

const radians = (deg: number): number => (deg * Math.PI) / 180

// Right-handed rotations about each axis, written from cos/sin directly so the fixtures do not lean
// on the decomposition under test.
const rx = (deg: number): Rotation => {
  const a = radians(deg)
  return [
    [1, 0, 0],
    [0, Math.cos(a), -Math.sin(a)],
    [0, Math.sin(a), Math.cos(a)],
  ]
}
const ry = (deg: number): Rotation => {
  const b = radians(deg)
  return [
    [Math.cos(b), 0, Math.sin(b)],
    [0, 1, 0],
    [-Math.sin(b), 0, Math.cos(b)],
  ]
}
const rz = (deg: number): Rotation => {
  const c = radians(deg)
  return [
    [Math.cos(c), -Math.sin(c), 0],
    [Math.sin(c), Math.cos(c), 0],
    [0, 0, 1],
  ]
}
const identity: Rotation = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

function multiply(a: Rotation, b: Rotation): Rotation {
  return a.map((row) =>
    [0, 1, 2].map((j) => [0, 1, 2].reduce((sum, k) => sum + (row[k] ?? 0) * (b[k]?.[j] ?? 0), 0)),
  )
}

function transpose(r: Rotation): Rotation {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => r[j]?.[i] ?? 0))
}

function matrix(r: Rotation): number[] {
  const out: number[] = []
  for (let row = 0; row < 3; row += 1) out.push(...(r[row] ?? []), 0)
  out.push(0, 0, 0, 1)
  return out
}

test('identity gives zero angles and the head on the lens axis', () => {
  const angles = headAnglesFromMatrix(matrix(identity))
  expect(angles?.yawDeg).toBeCloseTo(0, 6)
  expect(angles?.pitchDeg).toBeCloseTo(0, 6)
  expect(angles?.rollDeg).toBeCloseTo(0, 6)
  expect(angles?.lensAngleDeg).toBeCloseTo(0, 6)
})

test('a 30 degree yaw reads as 30 degrees of yaw and 30 degrees off the lens', () => {
  const angles = headAnglesFromMatrix(matrix(ry(30)))
  expect(angles?.yawDeg).toBeCloseTo(30, 6)
  expect(angles?.pitchDeg).toBeCloseTo(0, 6)
  expect(angles?.rollDeg).toBeCloseTo(0, 6)
  expect(angles?.lensAngleDeg).toBeCloseTo(30, 6)
})

test('a 20 degree pitch reads as 20 degrees of pitch and 20 degrees off the lens', () => {
  const angles = headAnglesFromMatrix(matrix(rx(20)))
  expect(angles?.pitchDeg).toBeCloseTo(20, 6)
  expect(angles?.yawDeg).toBeCloseTo(0, 6)
  expect(angles?.rollDeg).toBeCloseTo(0, 6)
  expect(angles?.lensAngleDeg).toBeCloseTo(20, 6)
})

test('tilting the head 45 degrees does not move the nose off the lens axis', () => {
  const angles = headAnglesFromMatrix(matrix(rz(45)))
  expect(angles?.rollDeg).toBeCloseTo(45, 6)
  expect(angles?.yawDeg).toBeCloseTo(0, 6)
  expect(angles?.pitchDeg).toBeCloseTo(0, 6)
  expect(angles?.lensAngleDeg).toBeCloseTo(0, 6)
})

test('yaw 30 then pitch 20 combine into a single lens angle of acos(cos30·cos20)', () => {
  const angles = headAnglesFromMatrix(matrix(multiply(ry(30), rx(20))))
  expect(angles?.lensAngleDeg).toBeCloseTo(35.531347762804174, 6)
  expect(angles?.yawDeg).toBeCloseTo(30, 6)
  expect(angles?.pitchDeg).toBeCloseTo(20, 6)
})

test('the lens angle is the same whether the matrix is read row-major or column-major', () => {
  const angles = headAnglesFromMatrix(matrix(transpose(multiply(ry(30), rx(20)))))
  expect(angles?.lensAngleDeg).toBeCloseTo(35.531347762804174, 6)
})

test('anything but sixteen numbers is not a transformation matrix', () => {
  expect(headAnglesFromMatrix(new Array<number>(9).fill(0))).toBeNull()
  expect(headAnglesFromMatrix(new Array<number>(15).fill(0))).toBeNull()
})

// Which way +Z points is the one thing about MediaPipe's matrix that the published types do not
// state, so the lens angle folds the sign away. Drop the fold and every frontal face under the
// opposite convention would read as 180 degrees off the lens, and nobody would ever look at it.
// The yaw is deliberately left unfolded, which is why only the variance of it is ever reported.
test('a negative m(2,2) folds to the same lens angle as its positive twin', () => {
  const angles = headAnglesFromMatrix(matrix(ry(150)))
  expect(angles?.lensAngleDeg).toBeCloseTo(30, 6)
  expect(angles?.yawDeg).toBeCloseTo(150, 6)
})
