import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// PROJECT.md §7 and §10 stage 8: voice reports observable pace, pauses and filler words only, and
// those observations are kept "entirely separate from competence". That separation is worth exactly
// as much as the check that enforces it, and it fails the same way an aggregate score would — by
// accident, when someone folds a delivery number into a finding to make a card look complete.
//
// Two things are checked, both structural:
//   1. the finding contract never mentions a delivery signal, so a delivery field cannot be a
//      finding field;
//   2. no delivery signal is ever computed inside the evaluation or gap-ledger paths.
const DELIVERY_SIGNALS =
  /\b(wordsPerMinute|fillerCounts|fillerRate\w*|longPauseCount|longestPauseMs|spokenSeconds)\b/

const JUDGMENT_PATHS = [
  'packages/core/src/evaluation',
  'packages/core/src/gaps',
  'packages/core/src/policy',
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path)
  }
  return out
}

test('the finding contract has no delivery field', () => {
  const contract = readFileSync('packages/contracts/src/finding.ts', 'utf8')

  expect(DELIVERY_SIGNALS.test(contract)).toBe(false)
  expect(contract).not.toContain('DeliveryReport')
})

test('no delivery signal is read where an answer is judged or a gap is moved', () => {
  const offenders: string[] = []
  for (const root of JUDGMENT_PATHS) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        if (DELIVERY_SIGNALS.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  expect(offenders).toEqual([])
})

// The report carries its own boundary as a value, so it stays labelled wherever it travels — into
// an export bundle, out of the HTTP API, into a terminal.
test('a delivery report declares that it is never competence', () => {
  const contract = readFileSync('packages/contracts/src/delivery.ts', 'utf8')

  expect(contract).toContain('delivery_only_never_competence')
  expect(contract).not.toContain('verdict')
  expect(contract).not.toContain('confidence')
})

// ---------------------------------------------------------------------------------------------
// Extended September 22, 2026, when the performance lane grew from three delivery numbers to a
// measured set covering speech, rhythm and body. The wall did not move. It got longer, so the check
// covering it got longer too.
//
// The new pressure on it is the debrief: the first surface that renders both lanes on one screen,
// and therefore the first place a well-meant change could average them into a single line.
const PERFORMANCE_TYPES =
  /\b(ProsodyReport|KinematicsReport|PerformanceObservation|PerformanceNote|PerformanceBaseline|PerformanceDrill|ScreenSimulation|SignalId|SIGNALS)\b/

const COMPETENCE_TYPES = /\b(Finding|GapEntry|Rubric|Competency|ClaimVerdict|ComposureSignal)\b/

test('the finding contract has no performance-lane type', () => {
  const contract = readFileSync('packages/contracts/src/finding.ts', 'utf8')

  expect(PERFORMANCE_TYPES.test(contract)).toBe(false)
})

test('no performance-lane type is read where an answer is judged or a gap is moved', () => {
  const offenders: string[] = []
  for (const root of JUDGMENT_PATHS) {
    for (const file of sourceFiles(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (PERFORMANCE_TYPES.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
        })
    }
  }
  expect(offenders).toEqual([])
})

// The two halves of the debrief are separate modules precisely so this check can exist. One may
// name findings and gaps. The other may name signals and observations. Neither may name both, so
// no function in the tree can see enough to merge them.
test('the debrief computes its two lanes in modules that cannot see each other', () => {
  const competence = readFileSync('packages/core/src/debrief/competence.ts', 'utf8')
  const performance = readFileSync('packages/core/src/debrief/performance.ts', 'utf8')

  expect(PERFORMANCE_TYPES.test(competence)).toBe(false)
  expect(DELIVERY_SIGNALS.test(competence)).toBe(false)
  expect(COMPETENCE_TYPES.test(performance)).toBe(false)
})

test('the performance modules never import the judgment modules', () => {
  const offenders: string[] = []
  for (const root of ['packages/core/src/performance', 'packages/core/src/debrief']) {
    for (const file of sourceFiles(root)) {
      if (file.endsWith('competence.ts')) continue
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/from '\.\.\/(evaluation|gaps|policy)\//.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`)
          }
        })
    }
  }
  expect(offenders).toEqual([])
})

// The screen mirror models what an outside system would say about the candidate. Letting that model
// reach the evaluator would make Levelhead grade the candidate on a guess about a third party.
test('the screen mirror never reaches a judgment path', () => {
  const offenders: string[] = []
  for (const root of [...JUDGMENT_PATHS, 'packages/core/src/debrief']) {
    for (const file of sourceFiles(root)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/from '.*\/mirror/.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
        })
    }
  }
  expect(offenders).toEqual([])
})
