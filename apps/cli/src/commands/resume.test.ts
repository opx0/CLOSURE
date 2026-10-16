import { test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SessionLog,
  claimConfirmedPayload,
  claimsExtractedPayload,
  linkSnapshotToClaims,
  runSession,
} from '@levelhead/core'
import { LOCAL_OWNER_ID, type Artifact, type Claim, type Span } from '@levelhead/contracts'
import { JsonlEventStore } from '../store/jsonl.ts'
import {
  FixedClock,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
  fakeInvocation,
} from '../testing/fakes.ts'
import { HARNESS_CEILINGS, recordedIo } from '../testing/harness.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { REPO_SESSION } from './repo.ts'

const CLI = join(import.meta.dir, '..', 'index.ts')
const STYLES = ['\u001b[1m', '\u001b[2m', '\u001b[0m']

const QUEUE_LINE = 'Built a durable job queue on PostgreSQL processing 10k jobs per day.'
const SEARCH_LINE = 'Optimized the search page.'
const RESUME = `# Jane Doe\n\n${QUEUE_LINE}\n${SEARCH_LINE}\n`

function span(id: string, quoted: string): Span {
  const startByte = RESUME.indexOf(quoted)
  return { id, sourceId: 'resume:test', startByte, endByte: startByte + quoted.length, quoted }
}

const QUEUE: Claim = {
  id: 'claim_queue',
  spanId: 'span_queue',
  type: 'built',
  assertion: 'built a durable job queue on PostgreSQL',
  technologies: ['PostgreSQL'],
  metrics: ['10k jobs per day'],
  implied: false,
  confirmedByCandidate: false,
  extractorVersion: 'claim-extraction@v1#test',
}

const SEARCH: Claim = {
  id: 'claim_search',
  spanId: 'span_search',
  type: 'optimized',
  assertion: 'optimized the search page',
  technologies: [],
  metrics: [],
  implied: false,
  confirmedByCandidate: false,
  extractorVersion: 'claim-extraction@v1#test',
}

const ARTIFACTS: Artifact[] = [
  {
    id: 'art_queue',
    snapshotId: 'snap_1',
    kind: 'function',
    path: 'src/queue.ts',
    symbol: 'claimJob',
    startLine: 1,
    endLine: 12,
  },
  { id: 'art_readme', snapshotId: 'snap_1', kind: 'file', path: 'README.md' },
]

async function seed(eventDir: string): Promise<void> {
  const store = new JsonlEventStore(eventDir, LOCAL_OWNER_ID)
  const clock = new FixedClock()
  const ids = new SeqIds()

  const claimSet = await SessionLog.open({ store, clock, ids }, CLAIM_SET_SESSION)
  await claimSet.append('state_change', {
    change: 'source_registered',
    sourceId: 'resume:test',
    kind: 'resume',
    text: RESUME,
    contentHash: 'test',
  })
  await claimSet.append(
    'state_change',
    claimsExtractedPayload({
      claims: [QUEUE, SEARCH],
      spans: [span('span_queue', QUEUE_LINE), span('span_search', SEARCH_LINE)],
      invocation: fakeInvocation(),
    }),
  )
  for (const confirmed of [QUEUE, SEARCH]) {
    await claimSet.append(
      'state_change',
      claimConfirmedPayload({ claimId: confirmed.id, confirmed: true }),
    )
  }

  const repo = await SessionLog.open({ store, clock, ids }, REPO_SESSION)
  await repo.append('state_change', {
    change: 'snapshot_pinned',
    snapshot: {
      id: 'snap_1',
      repoPath: '/work/queue',
      commit: 'abc123',
      pinnedAt: '2026-09-24T08:00:00.000Z',
      fileCount: 2,
    },
    artifacts: ARTIFACTS,
    evidence: linkSnapshotToClaims(ARTIFACTS, [QUEUE, SEARCH], ids),
  })

  await runSession({
    claims: [{ ...QUEUE, confirmedByCandidate: true }],
    rounds: ['project_deep_dive'],
    mode: 'coach',
    level: 'junior',
    personaId: 'collaborator',
    pressureCeiling: 1,
    turnsPerRound: 1,
    drill: false,
    ceilings: HARNESS_CEILINGS,
    deps: {
      store,
      clock,
      ids,
      conductor: new ScriptedConductor(['What happens when a worker dies mid-job?']),
      evaluator: new ScriptedEvaluator([
        {
          findings: [
            {
              kind: 'claim',
              verdict: 'partially_supported',
              rationale: 'lease recovery is described; duplicate completion is not',
              confidence: 0.8,
              quotes: ['I do not think we handled double completion'],
            },
          ],
        },
      ]),
      io: recordedIo([
        'The lease expires and another worker takes it. I do not think we handled double completion.',
      ]),
    },
  })
}

async function levelhead(args: readonly string[], eventDir: string) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: { ...process.env, LEVELHEAD_EVENT_DIR: eventDir, LEVELHEAD_STORE: 'jsonl' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  const plain = STYLES.reduce((text, style) => text.replaceAll(style, ''), out + err)
  return { code: await proc.exited, out: plain }
}

test('résumé feedback reads line by line: tags, advice, the candidate’s words, the files', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-resume-'))
  try {
    await seed(eventDir)

    const result = await levelhead(['resume'], eventDir)

    expect(result.code).toBe(0)
    expect(result.out.split('\n')).toEqual([
      '',
      'résumé feedback, line by line',
      '',
      QUEUE_LINE,
      '  files that share its words',
      '    Files in your pinned repository share words with this line. That is what an interviewer may open, not proof the code backs it: expect to explain why they are written this way and what breaks them.',
      '    src/queue.ts',
      '  partially supported',
      '    Your answer covered only part of this line; narrow it to what you explained, or prepare the part you could not.',
      '    │ I do not think we handled double completion',
      '  open gap',
      '    This line has a gap that has not yet held under a transfer question; close it before an interviewer who reads this line finds it.',
      '    │ I do not think we handled double completion',
      '',
      SEARCH_LINE,
      '  no number',
      '    Add the number you measured and its baseline; the first follow-up to this line is “by how much, measured how?”',
      '  no code behind it',
      '    Nothing in your pinned repositories links to this line; pin the repository that holds this work, or be ready to explain it with no code to point at.',
      '',
    ])
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)

test('with no résumé read, resume says where to start', async () => {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-resume-'))
  try {
    const result = await levelhead(['resume'], eventDir)

    expect(result.code).toBe(0)
    expect(result.out).toBe('no résumé read yet — run: levelhead claims <resume.md>\n')
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}, 20_000)
