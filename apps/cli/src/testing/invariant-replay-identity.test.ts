import { test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { replay, topicById } from '@levelhead/core'
import type { SessionView } from '@levelhead/core'
import type { RenderedQuestion } from '@levelhead/core'
import type { AnyEvent, Claim, Topic } from '@levelhead/contracts'
import { MemoryEventStore, ScriptedConductor, ScriptedEvaluator, fakeInvocation } from './fakes.ts'
import { citationFailures, runHarnessSession } from './harness.ts'
import { RecordedConductor, RecordedEvaluator, recordedAnswers } from './recorded.ts'

// Invariant: replaying a session from its own recorded model outputs (not the original script)
// reproduces byte-identical findings and event log — because ids/timestamps are injected rather
// than read from ambient state. Not proof of model determinism; see ticket 05 for that split.

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

const ANSWERS = [
  'We stored jobs in a Postgres table and leased each one for thirty seconds with SELECT FOR UPDATE SKIP LOCKED.',
  'If a worker died the lease expired and another worker picked the job up again, so a job could run twice.',
  'We chose Postgres over Redis because we already ran it, and we paid for that with lower throughput.',
]

const QUESTIONS = [
  'How does a worker take a job, exactly?',
  'What happens when a worker dies holding one?',
  'What did choosing Postgres cost you?',
]

function judged(
  verdict: 'supported' | 'partially_supported',
  claimQuote: string,
  competency: {
    name: 'mechanism' | 'failure_modes' | 'trade_offs'
    quote: string
    levelMet: 'mid' | null
  },
) {
  return {
    findings: [
      {
        kind: 'claim',
        verdict,
        rationale: `judged from the candidate's own words: ${claimQuote}`,
        confidence: 0.8,
        quotes: [claimQuote],
      },
      {
        kind: 'competency',
        competency: competency.name,
        levelMet: competency.levelMet,
        rationale: `the answer ${competency.levelMet === null ? 'does not reach' : 'reaches'} the mid anchor`,
        confidence: 0.65,
        quotes: [competency.quote],
      },
    ],
  }
}

const EVALUATIONS: readonly unknown[] = [
  judged('partially_supported', 'leased each one for thirty seconds', {
    name: 'mechanism',
    quote: 'SELECT FOR UPDATE SKIP LOCKED',
    levelMet: 'mid',
  }),
  judged('partially_supported', 'a job could run twice', {
    name: 'failure_modes',
    quote: 'the lease expired and another worker picked the job up again',
    levelMet: null,
  }),
  judged('supported', 'we paid for that with lower throughput', {
    name: 'trade_offs',
    quote: 'we already ran it',
    levelMet: 'mid',
  }),
]

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

// `SessionView` holds Maps, which `JSON.stringify` renders as `{}` — compare as arrays instead.
function provenance(view: SessionView) {
  return {
    findings: view.findings,
    spans: [...view.spans.entries()],
    evidence: [...view.evidence.entries()],
  }
}

async function original() {
  return runHarnessSession({
    claims: [CLAIM],
    answers: ANSWERS,
    turnsPerRound: ANSWERS.length,
    conductor: new ScriptedConductor(QUESTIONS),
    evaluator: new ScriptedEvaluator(EVALUATIONS),
  })
}

async function fromLog(events: readonly AnyEvent[]) {
  return runHarnessSession({
    claims: [CLAIM],
    answers: recordedAnswers(events),
    turnsPerRound: ANSWERS.length,
    conductor: new RecordedConductor(events),
    evaluator: new RecordedEvaluator(events),
    // A second store: both runs mint `ses_0001`, and appending twice at the same seq would violate
    // append-only.
    store: new MemoryEventStore(),
  })
}

test('the scripted session this invariant replays produces no dropped findings', async () => {
  const { events, result } = await original()

  // The precondition for a lossless reconstruction, asserted rather than assumed.
  expect(events.filter((event) => event.kind === 'observation')).toEqual([])
  expect(result.view.findings.length).toBe(ANSWERS.length * 2)
  expect(citationFailures(result.view)).toEqual([])
})

test('replaying the log with its own recorded model outputs reproduces the findings byte-for-byte', async () => {
  const first = await original()
  const second = await fromLog(first.events)

  const before = provenance(first.result.view)
  const after = provenance(second.result.view)

  // String form first: on failure bun diffs it, naming the field that leaked non-determinism.
  expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  expect(Buffer.compare(bytes(after), bytes(before))).toBe(0)

  // Not vacuous: there really were findings, spans and evidence links to compare.
  expect(before.findings).toHaveLength(ANSWERS.length * 2)
  expect(before.spans.length).toBeGreaterThan(0)
  expect(before.evidence.length).toBeGreaterThan(0)
})

test('the whole event log replays identically, which is the stronger claim the ledger rests on', async () => {
  const first = await original()
  const second = await fromLog(first.events)

  expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events))
  expect(Buffer.compare(bytes(second.events), bytes(first.events))).toBe(0)

  // A gap id that moved between runs would be a different ledger row pointing at the same evidence.
  expect([...second.result.view.gaps.entries()]).toEqual([...first.result.view.gaps.entries()])
})

test('the fold over a log is itself pure, so the same events always give the same view', async () => {
  const { events } = await original()

  expect(JSON.stringify(provenance(replay(events)))).toBe(
    JSON.stringify(provenance(replay([...events]))),
  )
})

test('a replay whose log runs out fails loudly instead of inventing the rest of the session', async () => {
  const { events } = await original()
  // One turn's worth of recorded output, four turns asked for — must not fall back to a fresh generation.
  const truncated = events.filter((event) => event.seq < 12)

  await expect(
    runHarnessSession({
      claims: [CLAIM],
      answers: recordedAnswers(events),
      turnsPerRound: ANSWERS.length + 1,
      conductor: new RecordedConductor(truncated),
      evaluator: new RecordedEvaluator(truncated),
      store: new MemoryEventStore(),
    }),
  ).rejects.toThrow(/no further/)
})

function topic(id: string): Topic {
  const found = topicById(id)
  if (found === undefined) throw new Error(`no topic ${id} in the catalog`)
  return found
}

test('a topic interview with an abstention replays from its own log byte-for-byte', async () => {
  const answers = [
    'Each thread holds one lock and waits for the lock the other one holds.',
    'You could maybe order the locks somehow, I am not sure.',
  ]
  const evaluations = [
    {
      findings: [
        {
          kind: 'competency',
          competency: 'mechanism',
          levelMet: 'junior',
          rationale: 'hold-and-wait on two locks is described',
          confidence: 0.7,
          quotes: ['holds one lock and waits for the lock the other one holds'],
        },
      ],
    },
    {
      findings: [
        {
          kind: 'competency_abstained',
          competency: 'trade_offs',
          abstention: 'insufficient_evidence',
          rationale: 'lock ordering is named but not described',
          confidence: 0.5,
          quotes: ['order the locks somehow'],
        },
      ],
    },
  ]
  const session = {
    claims: [],
    rounds: ['cs_fundamentals' as const],
    topics: [topic('os.deadlock')],
    level: 'junior' as const,
    turnsPerRound: answers.length,
  }

  const first = await runHarnessSession({
    ...session,
    answers,
    conductor: new ScriptedConductor(['Walk me through a deadlock.', 'How would you prevent it?']),
    evaluator: new ScriptedEvaluator(evaluations),
  })
  const second = await runHarnessSession({
    ...session,
    answers: recordedAnswers(first.events),
    conductor: new RecordedConductor(first.events),
    evaluator: new RecordedEvaluator(first.events),
    store: new MemoryEventStore(),
  })

  expect(first.result.view.findings.map((finding) => finding.kind)).toEqual([
    'competency',
    'competency_abstained',
  ])
  expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events))
})

// Shaped like the production conductor, which opens each round with a spoken line; the second
// line echoes the persona's own description and is refused, so it is logged without its text.
class BriefingConductor extends ScriptedConductor {
  readonly #briefs: string[]

  constructor(questions: readonly string[], briefs: readonly string[]) {
    super(questions)
    this.#briefs = [...briefs]
  }

  async renderRoundBrief(): Promise<RenderedQuestion> {
    return {
      text: this.#briefs.shift() ?? '',
      invocation: fakeInvocation({ port: 'conductor', promptId: 'round-brief' }),
    }
  }
}

test('round briefs are logged with their invocations and replay from the log byte-for-byte', async () => {
  const session = {
    claims: [CLAIM],
    rounds: ['project_deep_dive' as const, 'design_extension' as const],
    turnsPerRound: 1,
  }
  const first = await runHarnessSession({
    ...session,
    answers: [ANSWERS[0] ?? '', ANSWERS[2] ?? ''],
    conductor: new BriefingConductor(QUESTIONS, ['Tell me about the queue.', 'voice: doubtful']),
    evaluator: new ScriptedEvaluator([EVALUATIONS[0], EVALUATIONS[2]]),
  })
  const second = await runHarnessSession({
    ...session,
    answers: recordedAnswers(first.events),
    conductor: new RecordedConductor(first.events),
    evaluator: new RecordedEvaluator(first.events),
    store: new MemoryEventStore(),
  })

  const opened = first.events.flatMap((event) =>
    event.kind === 'state_change' && event.payload.change === 'round_started'
      ? [[event.payload.brief, event.payload.briefInvocation?.promptId]]
      : [],
  )
  expect(opened).toEqual([
    ['Tell me about the queue.', 'round-brief'],
    [undefined, 'round-brief'],
  ])
  expect(
    first.result.view.invocations.filter((call) => call.promptId === 'round-brief'),
  ).toHaveLength(2)
  expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events))
})
