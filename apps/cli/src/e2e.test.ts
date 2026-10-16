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
    'Let us start with how the machine works underneath.',
    'Two threads, two locks: how do they end up stuck?',
    'Let us start with the fundamentals.',
    'Walk me through what happens underneath.',
    'Tell me about the queue you built.',
    'How does a job get picked up, and what happens if the worker dies mid-job?',
    'Open the code with me.',
    'In queue.ts, claimJob leases for 30 seconds. What happens at 45?',
  ],
  evaluations: [
    {
      findings: [
        {
          kind: 'competency',
          competency: 'mechanism',
          levelMet: null,
          rationale: 'hold-and-wait is named; breaking the cycle is not',
          confidence: 0.8,
          quotes: ['I am not sure how you prevent it'],
        },
      ],
    },
    {
      findings: [
        {
          kind: 'competency_abstained',
          competency: 'mechanism',
          abstention: 'insufficient_evidence',
          rationale: 'the answer names no mechanism to judge',
          confidence: 0.6,
          quotes: ['I would have to think about that one'],
        },
      ],
    },
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

const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-e2e-'))
const env = {
  ...process.env,
  LEVELHEAD_EVENT_DIR: eventDir,
  LLAMA_BASE_URL: `http://localhost:${server.port}/v1`,
  MODEL_PROVIDER_API_KEY: '',
}

afterAll(async () => {
  server.stop(true)
  await rm(eventDir, { recursive: true, force: true })
})

async function levelhead(
  args: readonly string[],
  stdin = '',
): Promise<{ code: number; out: string }> {
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

test('an interview needs no résumé: a labelled topic, a cited finding, a titled gap', async () => {
  const unknown = await levelhead(['session', '--topics', 'os.nope'])
  expect(unknown.code).toBe(1)
  expect(unknown.out).toContain('no topic with id os.nope — run: levelhead topics')

  const crossQuestioned = await levelhead(['session', '--rounds', 'project_deep_dive'])
  expect(crossQuestioned.code).toBe(1)
  expect(crossQuestioned.out).toContain(
    'cross-questioning your résumé needs a confirmed claim — run: levelhead claims <resume.md>',
  )

  const asked = await levelhead(
    ['session', '--topics', 'os.deadlock', '--turns', '1', '--no-drill'],
    'Each one holds a lock and waits for the other. I am not sure how you prevent it.\n\n',
  )
  expect(asked.code).toBe(0)
  expect(asked.out).toContain('Software engineer (general SDE) · junior')
  expect(asked.out).toContain('round 1 of 1 — CS fundamentals')
  expect(asked.out).toContain('os · Deadlock')
  expect(asked.out).toContain('Two threads, two locks: how do they end up stuck?')
  expect(asked.out).toContain('Finding — mechanism, met no level anchor.')
  expect(asked.out).toContain('I am not sure how you prevent it')
  expect(asked.out).toContain('Deadlock: hold-and-wait is named')
  expect(asked.out).not.toContain('résumé claim')

  const defaulted = await levelhead(
    ['session', '--turns', '1', '--no-drill'],
    'I would have to think about that one.\n\n',
  )
  expect(defaulted.code).toBe(0)
  expect(defaulted.out).toContain('round 1 of 1 — CS fundamentals')
  expect(defaulted.out).toMatch(/(os|dbms|networks|oop) · [A-Z]/)
  expect(defaulted.out).toContain('Finding — mechanism, abstained: insufficient evidence.')
  expect(defaulted.out).toContain('I would have to think about that one')
}, 30_000)

// Run in order, because each step is the input to the next.
test('résumé in, interrogation, cited finding, replayable log', async () => {
  const extracted = await levelhead(['claims', 'fixtures/resume-sample.md', '--yes'])
  expect(extracted.code).toBe(0)
  expect(extracted.out).toContain('durable job queue')
  expect(extracted.out).toContain('1 claims in play')

  const interviewed = await levelhead(
    ['session', '--rounds', 'project_deep_dive', '--turns', '1', '--no-drill'],
    `${ANSWER}\n\n`,
  )
  expect(interviewed.code).toBe(0)
  expect(interviewed.out).toContain('what happens if the worker dies')
  expect(interviewed.out).toContain('claim partially supported')
  // The candidate's own words, quoted back as the evidence for the judgment.
  expect(interviewed.out).toContain("I don't think we handled that")
  expect(interviewed.out).toContain('confidence: high')

  const ledger = await levelhead(['ledger'])
  expect(ledger.code).toBe(0)
  expect(ledger.out).toContain('Gap')
  expect(ledger.out).toContain('every citation resolves')

  const sessionId = /session (ses_[a-z0-9]+)/.exec(interviewed.out)?.[1]
  expect(sessionId).toBeDefined()
  const replayed = await levelhead(['replay', sessionId!])
  expect(replayed.code).toBe(0)
  expect(replayed.out).toContain('spans resolve byte-for-byte')
}, 30_000)

// The second half of the product: repository grounding, then review of the candidate's own words.
test('a pinned repository grounds a walkthrough round, and review reads the history back', async () => {
  const repoDir = await mkdtemp(join(tmpdir(), 'levelhead-repo-'))
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

  const pinned = await levelhead(['repo', repoDir])
  expect(pinned.code).toBe(0)
  expect(pinned.out).toContain('artifacts')
  // §4.8's boundary is stated to the candidate, not only in the spec.
  expect(pinned.out).toContain('parsed, never executed')

  const walked = await levelhead(
    ['session', '--rounds', 'code_walkthrough', '--turns', '1', '--no-drill', '--mode', 'coach'],
    'The lease expires and another worker takes it.\n\nn\n',
  )
  expect(walked.code).toBe(0)
  expect(walked.out).toContain('code walkthrough')
  expect(walked.out).toContain('queue.ts · claimJob · lines 1–4')
  expect(walked.out).toContain('1 │ export async function claimJob(db: Db) {')
  expect(walked.out).toContain('4 │ }')

  const reviewed = await levelhead(['review'])
  expect(reviewed.code).toBe(0)
  // Review is computed, not narrated: what it prints is verdicts and quotes over time.
  expect(reviewed.out.length).toBeGreaterThan(0)

  await rm(repoDir, { recursive: true, force: true })
}, 60_000)
