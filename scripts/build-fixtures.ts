import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

// The fixture repositories are stored as plain directories and materialised into git repositories on
// demand. Committing five nested repositories would make the working tree unnavigable, and a
// benchmark needs a *commit* to pin (§4.8) — so the commit is produced here, deterministically,
// rather than checked in.
const SOURCE = 'fixtures/repos'
const OUT = process.env.CLOSER_FIXTURE_DIR ?? '.closer/fixtures'

// Fixed author and date: a snapshot id derived from a commit that changes on every rebuild would
// make two runs of the same fixture set incomparable, which is the opposite of the point.
const AUTHOR = ['-c', 'user.email=fixtures@closer.local', '-c', 'user.name=CLOSER fixtures']
const WHEN = '2026-01-01T00:00:00Z'

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: WHEN, GIT_COMMITTER_DATE: WHEN },
  })
  const out = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${await new Response(proc.stderr).text()}`)
  }
  return out.trim()
}

const built: { id: string; path: string; commit: string; defects: number }[] = []

for (const id of (await readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const target = join(OUT, id)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(join(SOURCE, id, 'files'), target, { recursive: true })

  await git(target, ['init', '-q'])
  await git(target, ['add', '-A'])
  await git(target, [...AUTHOR, 'commit', '-qm', `fixture ${id}`])
  const commit = await git(target, ['rev-parse', 'HEAD'])

  const manifest = JSON.parse(await readFile(join(SOURCE, id, 'manifest.json'), 'utf8')) as {
    seededDefects: unknown[]
  }
  built.push({ id, path: target, commit, defects: manifest.seededDefects.length })
}

for (const fixture of built) {
  process.stdout.write(
    `${fixture.id.padEnd(18)} ${fixture.commit.slice(0, 12)}  ${fixture.defects} seeded defects  ${fixture.path}\n`,
  )
}
