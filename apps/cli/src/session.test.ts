import { test, expect } from 'bun:test'
import { replay, resolveSpan, topicById } from '@levelhead/core'
import type { PinnedContext, RepositoryPort } from '@levelhead/core'
import type { Artifact, Claim, GapEntry, Topic } from '@levelhead/contracts'
import { runSession, type SessionIo } from '@levelhead/core'
import {
  FixedClock,
  MemoryEventStore,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
} from './testing/fakes.ts'
import { citationFailures, runHarnessSession } from './testing/harness.ts'
import { topicLabel } from './commands/catalog.ts'
import { titled } from './commands/ledger.ts'
import { excerpt } from './commands/session.ts'

const CLAIM: Claim = {
  id: 'claim_0001',
  spanId: 'span_0001',
  type: 'built',
  assertion: 'built a durable job queue on PostgreSQL',
  technologies: ['PostgreSQL'],
  metrics: ['10k jobs/day'],
  implied: false,
  confirmedByCandidate: true,
  extractorVersion: 'claim-extraction@v1#test',
}

const ANSWER = 'We leased each job for 30 seconds. I do not think we handled double completion.'

function judged(quote: string) {
  return {
    findings: [
      {
        kind: 'claim' as const,
        verdict: 'partially_supported' as const,
        rationale: 'lease recovery is described; duplicate completion is not',
        confidence: 0.8,
        quotes: [quote],
      },
    ],
  }
}

function harness(answers: readonly string[]) {
  const store = new MemoryEventStore()
  const answered: string[] = []
  const seen: { questions: string[]; notices: string[] } = { questions: [], notices: [] }
  const io: SessionIo = {
    round() {},
    async confirmRetry() {
      return false
    },
    question(text) {
      seen.questions.push(text)
    },
    async answer() {
      const next = answers[answered.length] ?? ANSWER
      answered.push(next)
      return next
    },
    findings() {},
    notice(text) {
      seen.notices.push(text)
    },
  }
  return { store, io, seen }
}

async function run(turns: number, evaluations: readonly unknown[]) {
  const { store, io, seen } = harness([])
  const result = await runSession({
    claims: [CLAIM],
    rounds: ['project_deep_dive'],
    mode: 'coach',
    level: 'mid',
    personaId: 'skeptic',
    pressureCeiling: 3,
    turnsPerRound: turns,
    drill: false,
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    deps: {
      store,
      clock: new FixedClock(),
      ids: new SeqIds(),
      conductor: new ScriptedConductor(['How does the lease work?', 'And when it expires?']),
      evaluator: new ScriptedEvaluator(evaluations),
      io,
    },
  })
  return { result, store, seen }
}

test('a session produces a cited finding the candidate can check', async () => {
  const { result } = await run(1, [judged('I do not think we handled double completion')])

  expect(result.view.transcript.map((turn) => turn.role)).toEqual(['interviewer', 'candidate'])
  expect(result.view.findings).toHaveLength(1)

  // The point of the whole design: every citation resolves byte-for-byte against what was said.
  for (const finding of result.view.findings) {
    for (const spanId of finding.transcriptSpanIds) {
      const span = result.view.spans.get(spanId)
      expect(span).toBeDefined()
      expect(resolveSpan(span!, result.view.sources).ok).toBe(true)
    }
  }
})

test('an unsupported finding opens a gap, and the gap is not closed', async () => {
  const { result } = await run(1, [judged('I do not think we handled double completion')])
  const gaps = [...result.view.gaps.values()]

  expect(gaps).toHaveLength(1)
  expect(gaps[0]?.status).toBe('open')
  expect(gaps[0]?.findingIds).toHaveLength(1)
})

test('a finding whose quote was never said is dropped rather than cited', async () => {
  const { result, store } = await run(1, [judged('a sentence the candidate never uttered')])

  expect(result.view.findings).toHaveLength(0)
  // Dropped findings are still recorded: silence about a rejected judgment is its own dishonesty.
  const notes = [...store.sessions.values()].flat().filter((event) => event.kind === 'observation')
  expect(notes.length).toBeGreaterThan(0)
})

test('replaying a session is byte-identical, which is what makes the log the source of truth', async () => {
  const { result, store } = await run(2, [
    judged('I do not think we handled double completion'),
    judged('We leased each job for 30 seconds'),
  ])
  const events = await store.read(result.sessionId)

  expect(JSON.stringify(replay(events))).toEqual(JSON.stringify(replay(events)))
})

test('an evaluator failure stops the session instead of finishing it unjudged', async () => {
  const { result, seen } = await run(2, [])

  expect(result.stoppedBy).toBe('evaluator_failure')
  expect(seen.notices.join(' ')).toContain('evaluator failed')
})

test('a drill moves a gap to drilled, and only a transfer closes it', async () => {
  const store = new MemoryEventStore()
  const clock = new FixedClock()
  const ids = new SeqIds()
  const io: SessionIo = {
    round() {},
    async confirmRetry() {
      return false
    },
    question() {},
    async answer() {
      return ANSWER
    },
    findings() {},
    notice() {},
  }
  const base = {
    claims: [CLAIM],
    rounds: ['project_deep_dive' as const],
    level: 'mid' as const,
    personaId: 'skeptic' as const,
    pressureCeiling: 3 as const,
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
  }

  const interrogation = await runSession({
    ...base,
    mode: 'coach' as const,
    turnsPerRound: 1,
    drill: true,
    deps: {
      store,
      clock,
      ids,
      conductor: new ScriptedConductor(['q', 'drill q']),
      evaluator: new ScriptedEvaluator([
        judged('I do not think we handled double completion'),
        // The drill lands: a supported claim is what moves the gap.
        {
          findings: [
            {
              kind: 'claim' as const,
              verdict: 'supported' as const,
              rationale: 'idempotent completion described',
              confidence: 0.9,
              quotes: ['We leased each job for 30 seconds'],
            },
          ],
        },
      ]),
      io,
    },
  })

  const drilledGap = [...interrogation.view.gaps.values()][0]
  expect(drilledGap?.status).toBe('drilled')

  const retest = await runSession({
    ...base,
    mode: 'transfer' as const,
    turnsPerRound: 1,
    drill: false,
    transferGap: drilledGap!,
    deps: {
      store,
      clock,
      ids,
      conductor: new ScriptedConductor(['same idea, different system']),
      evaluator: new ScriptedEvaluator([
        {
          findings: [
            {
              kind: 'claim' as const,
              verdict: 'supported' as const,
              rationale: 'the idea generalised',
              confidence: 0.9,
              quotes: ['We leased each job for 30 seconds'],
            },
          ],
        },
      ]),
      io,
    },
  })

  const closed = retest.view.gaps.get(drilledGap!.id)
  expect(closed?.status).toBe('closed_under_transfer')
  expect(closed?.transferAttemptIds.length).toBeGreaterThan(0)
})

test('a due gap comes back unannounced, and failing it reopens the row', async () => {
  const store = new MemoryEventStore()
  const io: SessionIo = {
    round() {},
    async confirmRetry() {
      return false
    },
    question() {},
    async answer() {
      return ANSWER
    },
    findings() {},
    notice() {},
  }
  const closed: GapEntry = {
    id: 'gap_0001',
    competency: 'failure_modes',
    claimId: CLAIM.id,
    summary: 'Double completion after worker resurrection',
    status: 'closed_under_transfer',
    findingIds: ['fnd_old'],
    evidenceIds: ['evd_old'],
    openedAt: '2026-07-01T00:00:00.000Z',
    lastTouchedAt: '2026-07-02T00:00:00.000Z',
    transferAttemptIds: ['att_old'],
    retrievals: [],
  }

  const result = await runSession({
    claims: [CLAIM],
    rounds: ['project_deep_dive'],
    mode: 'coach',
    level: 'mid',
    personaId: 'skeptic',
    pressureCeiling: 3,
    turnsPerRound: 3,
    drill: false,
    retrievals: [closed],
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    deps: {
      store,
      clock: new FixedClock(),
      ids: new SeqIds(),
      conductor: new ScriptedConductor(['q1', 'q2', 'q3']),
      evaluator: new ScriptedEvaluator([
        judged('I do not think we handled double completion'),
        judged('I do not think we handled double completion'),
        // The retrieval turn: still not supported, so the gap did not survive the wait.
        judged('I do not think we handled double completion'),
      ]),
      io,
    },
  })

  // §4.5: whatever the transfer said at the time, a gap that cannot be retrieved later was not
  // closed. A schedule that can only confirm success measures nothing.
  expect(result.view.gaps.get(closed.id)?.status).toBe('open')

  // And nothing the candidate saw marked it as a review: the retrieval arrived as an ordinary
  // failure-mode probe, indistinguishable from the rest of the interrogation. A retrieval someone
  // can recognise is not measuring retrieval.
  const events = await store.read(result.sessionId)
  const asked = events
    .filter((event) => event.kind === 'question')
    .map((event) => event.payload.text.toLowerCase())
  expect(asked.length).toBeGreaterThan(2)
  for (const question of asked) {
    for (const tell of ['retrieval', 'spaced', 'review', 'earlier gap', 'last time']) {
      expect(question).not.toContain(tell)
    }
  }

  // The action it was asked under is one the arc itself uses, not a review-shaped one.
  const retrievalTurn = events.find(
    (event) => event.kind === 'policy_action' && event.payload.attemptId === 'att_0005',
  )
  expect(retrievalTurn?.kind === 'policy_action' && retrievalTurn.payload.action).toBe(
    'TEST_FAILURE_MODE',
  )
})

function topic(id: string): Topic {
  const found = topicById(id)
  if (found === undefined) throw new Error(`no topic ${id} in the catalog`)
  return found
}

test('an interview with no résumé asks a labelled topic and cites the answer', async () => {
  const deadlock = topic('os.deadlock')
  const conductor = new ScriptedConductor(['Two threads, two locks: how do they end up stuck?'])
  const { result, io } = await runHarnessSession({
    claims: [],
    rounds: ['cs_fundamentals'],
    topics: [deadlock],
    level: 'junior',
    answers: ['Each one holds a lock and waits for the other. I am not sure how you prevent it.'],
    conductor,
    evaluator: new ScriptedEvaluator([
      {
        findings: [
          {
            kind: 'competency',
            competency: 'mechanism',
            levelMet: null,
            rationale: 'hold-and-wait is named; breaking the cycle is not',
            confidence: 0.7,
            quotes: ['I am not sure how you prevent it'],
          },
        ],
      },
    ]),
  })

  const [asked] = io.asked
  expect(asked?.text).toBe('Two threads, two locks: how do they end up stuck?')
  expect(asked?.meta.topic).toEqual({ id: 'os.deadlock', area: 'os', title: 'Deadlock' })
  expect(asked?.meta.topic === undefined ? '' : topicLabel(asked.meta.topic)).toBe('os · Deadlock')
  expect(conductor.calls[0]?.claim).toBeNull()
  expect(conductor.calls[0]?.topic).toEqual({
    id: 'os.deadlock',
    area: 'os',
    title: 'Deadlock',
    ask: deadlock.ask,
  })
  expect(result.view.session?.claimIds).toEqual([])
  expect(result.view.session?.topicIds).toEqual(['os.deadlock'])

  const [finding] = result.view.findings
  expect(finding?.kind).toBe('competency')
  expect(citationFailures(result.view)).toEqual([])
  expect(result.view.spans.get(finding?.transcriptSpanIds[0] ?? '')?.quoted).toBe(
    'I am not sure how you prevent it',
  )

  const gaps = [...result.view.gaps.values()]
  expect(gaps.map((gap) => [gap.topicId, gap.claimId, gap.status])).toEqual([
    ['os.deadlock', undefined, 'open'],
  ])
  expect(gaps.map((gap) => titled(gap).summary)).toEqual([
    'Deadlock: hold-and-wait is named; breaking the cycle is not',
  ])
})

test('a walkthrough with a pinned repository and no résumé opens the code it asks about', async () => {
  const code = [
    'export async function claimJob(db: Db) {',
    '  const lease = Date.now() + 30_000',
    '  return db.claim(lease)',
    '}',
  ].join('\n')
  const artifact = (id: string, path: string, symbol: string, startLine: number): Artifact => ({
    id,
    snapshotId: 'snap_1',
    kind: 'function',
    path,
    symbol,
    startLine,
    endLine: startLine + 3,
  })
  const repository: RepositoryPort = {
    async pin() {
      throw new Error('a session never pins')
    },
    async read(opened) {
      return opened.id === 'art_claim' ? code : null
    },
  }
  const pinned: PinnedContext = {
    snapshot: {
      id: 'snap_1',
      repoPath: '/work/queue',
      commit: 'abc123',
      pinnedAt: '2026-09-24T08:00:00.000Z',
      fileCount: 2,
    },
    artifacts: [
      artifact('art_test', 'src/queue.test.ts', 'claimsOnce', 1),
      artifact('art_claim', 'src/queue.ts', 'claimJob', 10),
    ],
    evidence: [],
    repository,
  }
  const conductor = new ScriptedConductor(['In claimJob, what happens when the lease runs out?'])

  const { result, io } = await runHarnessSession({
    claims: [],
    rounds: ['code_walkthrough'],
    pinned,
    answers: ['Another worker claims it. We never checked for a double completion.'],
    conductor,
    evaluator: new ScriptedEvaluator([
      {
        findings: [
          {
            kind: 'competency',
            competency: 'failure_modes',
            levelMet: null,
            rationale: 'the expiry is described; the duplicate completion is not handled',
            confidence: 0.75,
            quotes: ['We never checked for a double completion'],
          },
        ],
      },
    ]),
  })

  const shown = io.asked[0]?.meta.artifact
  expect(shown === undefined ? undefined : excerpt(shown)).toEqual({
    where: 'src/queue.ts · claimJob · lines 10–13',
    lines: [
      '10 │ export async function claimJob(db: Db) {',
      '11 │   const lease = Date.now() + 30_000',
      '12 │   return db.claim(lease)',
      '13 │ }',
    ],
  })
  expect(conductor.calls[0]?.artifact?.code).toBe(code)
  expect(conductor.calls[0]?.claim).toBeNull()
  expect(result.view.session?.claimIds).toEqual([])
  expect(result.view.session?.snapshotId).toBe('snap_1')

  const [finding] = result.view.findings
  expect(finding?.kind).toBe('competency')
  expect(citationFailures(result.view)).toEqual([])
  expect(result.view.spans.get(finding?.transcriptSpanIds[0] ?? '')?.quoted).toBe(
    'We never checked for a double completion',
  )
})
