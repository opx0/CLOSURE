import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PROBE = fileURLToPath(new URL('./no-network.probe.ts', import.meta.url))

// ADR-016: parsing runs with no network. The guard is checked in a fresh process because it
// replaces module-level functions — asserting it in-process would poison every test after it.
test('a parse step that reaches for the network fails loudly', () => {
  const result = spawnSync(process.execPath, [PROBE], { encoding: 'utf8' })

  expect(result.status).toBe(0)
  expect(result.stdout).toContain('fetch:blocked')
  expect(result.stdout).toContain('tcp:blocked')
  expect(result.stdout).toContain('dns:blocked')
})
