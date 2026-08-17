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
