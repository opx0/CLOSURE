import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { KinematicsReportSchema, ProsodyReportSchema } from '@levelhead/contracts'
import type { TSchema } from '@sinclair/typebox'

// Video is captured, analysed and discarded inside the browser. What crosses the wire is a fixed set
// of aggregates. That is a privacy promise, and a promise about a payload shape is checkable, so it
// is checked: the kinematics report is walked and every leaf must be a number.
//
// The failure this stops is the plausible one. Someone wants a nicer chart, adds `perFrame:
// Landmark[]` to make it, and the session is suddenly shipping a biometric time series to a server.
function leafTypes(schema: TSchema, path: string, out: string[]): void {
  const node = schema as unknown as Record<string, unknown>
  const kind = node.type

  if (kind === 'object') {
    for (const [key, child] of Object.entries((node.properties ?? {}) as Record<string, TSchema>)) {
      leafTypes(child, `${path}.${key}`, out)
    }
    return
  }
  if (kind === 'array') {
    out.push(`${path}: array`)
    return
  }
  if (Array.isArray(node.anyOf)) {
    ;(node.anyOf as TSchema[]).forEach((child, index) => leafTypes(child, `${path}|${index}`, out))
    return
  }
  out.push(`${path}: ${String(kind ?? (node.const !== undefined ? 'const' : 'unknown'))}`)
}

test('the kinematics report carries aggregates only, never a per-frame series', () => {
  const leaves: string[] = []
  leafTypes(KinematicsReportSchema, 'kinematics', leaves)

  expect(leaves.filter((leaf) => leaf.endsWith(': array'))).toEqual([])
  const disallowed = leaves.filter(
    (leaf) => !/: (number|integer|string|const)$/.test(leaf) && !leaf.endsWith('|0: string'),
  )
  expect(disallowed).toEqual([])
})

// Prosody is allowed arrays: word timings and pauses are what makes a pause taxonomy possible, and
// they are derived from a transcript the candidate already owns. What it may not carry is audio.
test('the prosody report carries timings, never audio', () => {
  const leaves: string[] = []
  leafTypes(ProsodyReportSchema, 'prosody', leaves)

  expect(leaves.filter((leaf) => /audioBytes|waveform|samples|pcm/i.test(leaf))).toEqual([])
})

const BIOMETRIC = /\b(landmark|landmarks|faceMesh|videoFrame|frameBuffer|imageBytes|rawFrames)\b/i

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

test('no contract and no route names a biometric payload', () => {
  const offenders: string[] = []
  for (const root of ['packages/contracts/src', 'apps/server/src']) {
    for (const file of sourceFiles(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (BIOMETRIC.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
        })
    }
  }
  expect(offenders).toEqual([])
})
