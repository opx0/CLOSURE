import { test, expect } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'index.ts')

const RESUME = `# Jane Doe

Built a durable job queue on PostgreSQL processing 10k jobs per day.
`

const JOB = `# Senior Backend Engineer

## Requirements

- Ship PostgreSQL and Kubernetes in production
- Operate Redis clusters at scale
`

async function levelhead(
  args: readonly string[],
  eventDir: string,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, LEVELHEAD_EVENT_DIR: eventDir, LEVELHEAD_STORE: 'jsonl' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  return { code: await proc.exited, out: out + err }
}

test('mirror flags a required term absent from the résumé and refuses a match score', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-mirror-'))
  try {
    const resumePath = join(dir, 'resume.md')
    const jobPath = join(dir, 'job.md')
    await writeFile(resumePath, RESUME, 'utf8')
    await writeFile(jobPath, JOB, 'utf8')

    const result = await levelhead(['mirror', '--resume', resumePath, '--job', jobPath], dir)

    expect(result.code).toBe(0)
    expect(result.out).toContain('a model of an outside system, never a judgment of you')
    // Kubernetes is required by the posting and appears nowhere in the résumé.
    expect(result.out).toContain('"kubernetes" appears in the posting and nowhere in your')
    // PostgreSQL is in both, so it is not flagged absent.
    expect(result.out).not.toContain('"postgresql" appears in the posting and nowhere')
    // The disclaimer that there is no score by design.
    expect(result.out).toContain('it produces no match number')
    // No claims were confirmed for this résumé, and the command says so.
    expect(result.out).toContain('No confirmed claims for this résumé')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 20_000)

test('mirror without both files prints usage and fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-mirror-'))
  try {
    const resumePath = join(dir, 'resume.md')
    await writeFile(resumePath, RESUME, 'utf8')
    const result = await levelhead(['mirror', '--resume', resumePath], dir)
    expect(result.code).toBe(1)
    expect(result.out).toContain('levelhead mirror --resume <file> --job <file>')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 20_000)
