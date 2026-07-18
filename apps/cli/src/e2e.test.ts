import { test, expect, afterAll } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeProvider } from './testing/fake-provider.ts'

const QUOTE = 'Built a durable job queue on PostgreSQL processing ~10k jobs/day'
const ANSWER = "We leased each job for 30 seconds. I don't think we handled that."

const server = startFakeProvider({
  claims: {
    claims: [
      {
        quote: QUOTE,
        assertion: 'built a durable job queue on PostgreSQL',
        type: 'built',
        technologies: ['PostgreSQL'],
        metrics: ['10k jobs/day'],
        implied: false,
      },
    ],
  },
  questions: [
    'How does a job get picked up, and what happens if the worker dies mid-job?',
    'Next round.',
    'In queue.ts, claimJob leases for 30 seconds. What happens at 45?',
  ],
  evaluations: [
    {
      findings: [
        {
          kind: 'claim',
          verdict: 'partially_supported',
          rationale: 'lease recovery is described; duplicate completion is not',
          confidence: 0.8,
          quotes: ["I don't think we handled that"],
        },
      ],
    },
    {
      findings: [
        {
          kind: 'claim',
          verdict: 'partially_supported',
          rationale: 'the expiry is described; the in-flight duplicate is not',
          confidence: 0.7,
          quotes: ['The lease expires and another worker takes it.'],
        },
      ],
    },
  ],
})

const eventDir = await mkdtemp(join(tmpdir(), 'closer-e2e-'))
const env = {
  ...process.env,
  CLOSER_EVENT_DIR: eventDir,
  LLAMA_BASE_URL: `http://localhost:${server.port}/v1`,
  MODEL_PROVIDER_API_KEY: '',
}

afterAll(async () => {
  server.stop(true)
  await rm(eventDir, { recursive: true, force: true })
})

async function closer(args: readonly string[], stdin = ''): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(['bun', 'apps/cli/src/index.ts', ...args], {
    env,
    stdin: new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  return { code: await proc.exited, out: out + err }
}

// One test, run in order, because each step is the input to the next.
test('résumé in, interrogation, cited finding, replayable log', async () => {
  const extracted = await closer(['claims', 'fixtures/resume-sample.md', '--yes'])
  expect(extracted.code).toBe(0)
  expect(extracted.out).toContain('durable job queue')
  expect(extracted.out).toContain('1 claims in play')

  const interviewed = await closer(['session', '--turns', '1', '--no-drill'], `${ANSWER}\n\n`)
  expect(interviewed.code).toBe(0)
  expect(interviewed.out).toContain('what happens if the worker dies')
  expect(interviewed.out).toContain('claim partially supported')
  // The candidate's own words, quoted back as the evidence for the judgment.
  expect(interviewed.out).toContain("I don't think we handled that")
  expect(interviewed.out).toContain('confidence: high')

  const ledger = await closer(['ledger'])
  expect(ledger.code).toBe(0)
  expect(ledger.out).toContain('Gap')
  expect(ledger.out).toContain('every citation resolves')

  const sessionId = /session (ses_[a-z0-9]+)/.exec(interviewed.out)?.[1]
  expect(sessionId).toBeDefined()
  const replayed = await closer(['replay', sessionId!])
  expect(replayed.code).toBe(0)
  expect(replayed.out).toContain('spans resolve byte-for-byte')
}, 30_000)

// The second half of the product: repository grounding, then review of the candidate's own words.
test('a pinned repository grounds a walkthrough round, and review reads the history back', async () => {
  const repoDir = await mkdtemp(join(tmpdir(), 'closer-repo-'))
  await Bun.write(
    join(repoDir, 'queue.ts'),
    'export async function claimJob(db: Db) {\n  const lease = Date.now() + 30_000\n  return db.claim(lease)\n}\n',
  )
  const git = async (...args: string[]) => {
    const proc = Bun.spawn(['git', '-C', repoDir, ...args], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  }
  await git('init', '-q')
  await git('add', '-A')
  await git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'queue')

  const pinned = await closer(['repo', repoDir])
  expect(pinned.code).toBe(0)
  expect(pinned.out).toContain('artifacts')
  // §4.8's boundary is stated to the candidate, not only in the spec.
  expect(pinned.out).toContain('parsed, never executed')

  const walked = await closer(
    ['session', '--rounds', 'code_walkthrough', '--turns', '1', '--no-drill', '--mode', 'coach'],
    'The lease expires and another worker takes it.\n\nn\n',
  )
  expect(walked.code).toBe(0)
  expect(walked.out).toContain('code walkthrough')

  const reviewed = await closer(['review'])
  expect(reviewed.code).toBe(0)
  // Review is computed, not narrated: what it prints is verdicts and quotes over time.
  expect(reviewed.out.length).toBeGreaterThan(0)

  await rm(repoDir, { recursive: true, force: true })
}, 60_000)
