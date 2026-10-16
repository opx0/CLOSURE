import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { FIXTURE_FILE, parseFixtures } from './fixtures.ts'
import { main, parseArgs } from './cli.ts'
import { syntheticFixtures } from './testing/synthetic.ts'

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-bench-cli-'))
  await writeFile(join(dir, FIXTURE_FILE), JSON.stringify(syntheticFixtures(), null, 2))
  return dir
}

async function capture(
  argv: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  const chunks: string[] = []
  const errors: string[] = []
  const stdout = process.stdout.write.bind(process.stdout)
  const stderr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((text: string) => {
    chunks.push(String(text))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((text: string) => {
    errors.push(String(text))
    return true
  }) as typeof process.stderr.write
  try {
    return { code: await main(argv), out: chunks.join(''), err: errors.join('') }
  } finally {
    process.stdout.write = stdout
    process.stderr.write = stderr
  }
}

describe('argument parsing', () => {
  test('fixtures and out are both required', () => {
    expect(parseArgs(['--fixtures', 'a'])).toContain('--out')
    expect(parseArgs(['--out', 'b'])).toContain('--fixtures')
  })

  test('an unknown flag is refused rather than ignored', () => {
    expect(parseArgs(['--fixtures', 'a', '--out', 'b', '--publish', 'no'])).toContain('--publish')
  })

  test('the bar must be one of the two ticket 05 declares', () => {
    expect(parseArgs(['--fixtures', 'a', '--out', 'b', '--bar', 'lenient'])).toContain('self_use')
  })
})

describe('the fixture loader', () => {
  test('a set that does not declare whether it is synthetic is refused', () => {
    const withoutFlag: Record<string, unknown> = { ...syntheticFixtures() }
    delete withoutFlag['synthetic']
    const loaded = parseFixtures(withoutFlag)
    expect(loaded.fixtures).toBeNull()
    expect(loaded.errors.some((error) => error.includes('synthetic'))).toBe(true)
  })

  test('an item pointing at a resume that is not in the set is refused', () => {
    const set = syntheticFixtures()
    const loaded = parseFixtures({
      ...set,
      items: set.items.map((item) => ({ ...item, resumeId: 'nowhere' })),
    })
    expect(loaded.fixtures).toBeNull()
    expect(loaded.errors.some((error) => error.includes('nowhere'))).toBe(true)
  })

  test('a well-formed set round-trips', () => {
    const loaded = parseFixtures(JSON.parse(JSON.stringify(syntheticFixtures())))
    expect(loaded.errors).toEqual([])
    expect(loaded.fixtures?.items[0]?.id).toBe('item-synthetic-1')
  })
})

describe('the CLI', () => {
  test('a dry run lists what it would do and invents no result', async () => {
    const dir = await fixtureDir()
    const out = await mkdtemp(join(tmpdir(), 'levelhead-bench-out-'))
    const { code, out: printed } = await capture(['--fixtures', dir, '--out', out, '--dry-run'])

    expect(code).toBe(0)
    expect(printed).toContain('synthetic-harness-check')
    expect(printed).toContain('SYNTHETIC')
    expect(printed).toContain('would write')
    expect(printed).toContain('nothing was executed')
    // No metric, no gate, no interval: a dry run has produced no outcome to report.
    expect(printed).not.toContain('claims permitted')
    expect(printed).not.toContain('gaps')
    // And nothing was written, because nothing was run.
    expect(await readdir(out)).toEqual([])
  })

  test('a real run without model ports refuses rather than fabricating them', async () => {
    const dir = await fixtureDir()
    const out = await mkdtemp(join(tmpdir(), 'levelhead-bench-out-'))
    const { code, err } = await capture(['--fixtures', dir, '--out', out])

    expect(code).toBe(2)
    expect(err).toContain('will not fabricate model ports')
    expect(await readdir(out)).toEqual([])
  })
})
