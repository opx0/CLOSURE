import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Ticket 05 §3: "no aggregate score exists" is an invariant, checked mechanically, because
// PROJECT.md §12's promise is worth exactly as much as the check that enforces it. An aggregate is
// the single field that would turn CLOSER back into the thing it was built to replace, and it
// arrives by accident — someone adds `overallScore` to make a table sort nicely.
const BANNED = /\b(readiness|overall|composite|aggregate|total)_?[Ss]core\b|\bscore(Percent|Pct)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    // `testing/` holds the hostile and seeded fixtures, whose whole job is to *attempt* the thing
    // this test forbids. Scanning them would make the harness that proves the invariant look like
    // the violation.
    if (entry === 'node_modules' || entry === 'testing' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path)
  }
  return out
}

test('no schema anywhere declares an aggregate readiness score', () => {
  const offenders: string[] = []
  for (const root of ['packages', 'apps']) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        if (BANNED.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  expect(offenders).toEqual([])
})
