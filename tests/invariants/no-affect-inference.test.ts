import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// CONTEXT.md, "What Levelhead must never claim": Levelhead does not detect lying, memorization,
// personality, emotion, or confidence. Adding cameras and microphones is exactly the moment that
// promise becomes cheap to break, because every off-the-shelf face and voice model ships an affect
// head and it is one field away from the report.
//
// So the promise gets the same treatment as the aggregate score: a check, not a sentence.
//
// The pattern runs against source with comments stripped. A comment saying "no emotion is inferred
// here" is the opposite of a violation, and a test that punished it would push the explanation out
// of the file where it belongs.
const AFFECT =
  /\b(emotion|emotional|sentiment|affectState|arousal|valenceOf|mood|stressLevel|anxiety|nervousness|engagementScore|enthusiasm|deception|deceptive|truthfulness|personality|cultureFit|smileRatio|frownRatio|blinkRate|microExpression)\b/i

const ROOTS = ['packages', 'apps']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path)
  }
  return out
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

function stripPythonComments(text: string): string {
  return text.replace(/"""[\s\S]*?"""/g, ' ').replace(/#[^\n]*/g, ' ')
}

test('no source infers an inner state from a face, a voice or a body', () => {
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (AFFECT.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
        })
    }
  }
  expect(offenders).toEqual([])
})

test('the local speech sidecar infers no inner state either', () => {
  const offenders: string[] = []
  for (const file of readdirSync('voice').filter((name) => name.endsWith('.py'))) {
    stripPythonComments(readFileSync(join('voice', file), 'utf8'))
      .split('\n')
      .forEach((line, index) => {
        if (AFFECT.test(line)) offenders.push(`voice/${file}:${index + 1}: ${line.trim()}`)
      })
  }
  expect(offenders).toEqual([])
})

// The registry is the list of everything Levelhead is willing to measure about a body or a voice.
// Enumerating it in a test is how a new signal gets a second pair of eyes: adding one here is
// deliberate, and adding one without touching this file fails.
test('the measured signal set is exactly what was agreed, and nothing has been slipped in', () => {
  const source = readFileSync('packages/contracts/src/performance.ts', 'utf8')
  const declared = [...source.matchAll(/^\s*Type\.Literal\('([a-z_]+)'\),$/gm)].map(
    (match) => match[1],
  )

  expect(declared).toContain('gaze_on_camera_ratio')
  expect(declared).toContain('interruption_recovery_time')
  expect(declared).not.toContain('blink_rate')
  expect(declared).not.toContain('stress_level')
  expect(declared).not.toContain('confidence_level')
})
