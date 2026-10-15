import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { JobRecord, PolicyAction, RoundKind } from '@levelhead/contracts'
import { silentLogger } from '@levelhead/core'
import type {
  Clock,
  ConductorPort,
  EvaluatorPort,
  EventStore,
  IdSource,
  JobQueuePort,
  RenderQuestionInput,
  RenderRoundBriefInput,
  RenderedQuestion,
  StructuredRequest,
  StructuredResult,
} from '@levelhead/core'
import {
  DEFAULT_INGEST_LIMITS,
  pinIsolated,
} from '../../../worker/src/handlers/ingest-repository.ts'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import {
  FixedClock,
  MemoryEventStore,
  SeqIds,
  fakeInvocation,
} from '../../../cli/src/testing/fakes.ts'

// The real HTTP surface and the real built client, with scripted model ports behind them. The
// browser journey must exercise Levelhead's own wiring, not a provider's availability — and a live
// model in an end-to-end test measures the model, not the product.
//
// Scripted by subject rather than by call order: a journey that asks a topic, a claim and a file
// in any order still gets an answer shaped for what was actually asked.

const RESUME_QUOTE = 'Built a durable job queue on PostgreSQL'

const EXTRACTION = {
  claims: [
    {
      quote: RESUME_QUOTE,
      assertion: 'built a durable job queue on PostgreSQL',
      type: 'built',
      technologies: ['PostgreSQL'],
      metrics: ['10k jobs/day'],
      implied: false,
    },
  ],
}

const BRIEFS: Record<RoundKind, string> = {
  cs_fundamentals:
    'We will start with fundamentals. Think out loud, and say so when you do not know.',
  problem_solving:
    'Now a problem to reason through out loud. No code, just the approach and its cost.',
  role_knowledge: 'Some questions about the tools this role leans on every day.',
  system_design: 'Let us design something together. Give each part a reason.',
  behavioral: 'Tell me about a few things you have actually done.',
  project_deep_dive: 'I read your résumé. Let us go underneath one of those lines.',
  design_extension: 'Let us push your own design somewhere new.',
  code_walkthrough: 'I have your repository open. Walk me through what I point at.',
}

const CLAIM_QUESTIONS: Partial<Record<PolicyAction, string>> = {
  PROBE_MECHANISM: 'walk me through how a job is claimed',
  TEST_FAILURE_MODE: 'and what stops it completing twice?',
  FALSE_PREMISE: 'so the database guarantees that on its own, right?',
}

const TWISTED: ReadonlySet<PolicyAction> = new Set([
  'CHANGE_CONSTRAINT',
  'CONSTRAINT_SHOCK',
  'DRILL',
  'TRANSFER_TEST',
])

function opening(ask: string): string {
  const task = /^Ask them to (.+)$/.exec(ask)?.[1]
  if (task !== undefined) return task.charAt(0).toUpperCase() + task.slice(1)
  const rest = /^Ask them (.+)$/.exec(ask)?.[1]
  return rest === undefined ? ask : `Tell me ${rest}`
}

function questionFor(input: RenderQuestionInput): string {
  const { action, artifact, topic, seed } = input
  if (seed !== undefined && action === 'FALSE_PREMISE') return `${seed} Would you agree?`
  if (seed !== undefined && TWISTED.has(action)) return `Suppose ${seed}. What changes?`
  if (artifact !== undefined) {
    const where = artifact.symbol ?? artifact.path
    if (action === 'TEST_FAILURE_MODE') {
      return `What breaks in ${where} when two callers reach it at the same moment?`
    }
    if (action === 'PROBE_TRADE_OFF') {
      return `Why is ${where} written this way, and what would you give up to change it?`
    }
    return `Walk me through ${where} in ${artifact.path}, line by line.`
  }
  if (topic !== undefined) {
    if (action === 'PROBE_MECHANISM') return opening(topic.ask)
    if (action === 'TEST_FAILURE_MODE') return 'Where does that break down in practice?'
    if (action === 'PROBE_TRADE_OFF')
      return 'What does that cost you, and when would you choose differently?'
    if (action === 'REQUEST_EVIDENCE') return 'How would you show me that is true?'
    return 'Go one layer deeper on that.'
  }
  return CLAIM_QUESTIONS[action] ?? 'what would you change about it at ten times the load?'
}

class SubjectConductor implements ConductorPort {
  async renderQuestion(input: RenderQuestionInput): Promise<RenderedQuestion> {
    return {
      text: questionFor(input),
      invocation: fakeInvocation({ port: 'conductor', promptId: 'question-render' }),
    }
  }

  async renderRoundBrief(input: RenderRoundBriefInput): Promise<RenderedQuestion> {
    return {
      text: BRIEFS[input.round],
      invocation: fakeInvocation({ port: 'conductor', promptId: 'round-brief' }),
    }
  }
}

function fenced(prompt: string, label: string): string | undefined {
  const fence = `<<<UNTRUSTED_${label}>>>`
  const start = prompt.indexOf(`${fence}\n`)
  if (start < 0) return undefined
  const end = prompt.indexOf(`\n${fence}`, start + fence.length + 1)
  return end < 0 ? undefined : prompt.slice(start + fence.length + 1, end)
}

function lastSentence(answer: string): string {
  const sentences = answer
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence !== '')
  return (sentences.at(-1) ?? answer.trim()).replace(/[.!?]+$/, '')
}

const PROBES: Partial<Record<PolicyAction, 'mechanism' | 'trade_offs' | 'failure_modes'>> = {
  TEST_FAILURE_MODE: 'failure_modes',
  PROBE_TRADE_OFF: 'trade_offs',
  CHANGE_CONSTRAINT: 'trade_offs',
}

function judge(prompt: string): unknown {
  const answer = fenced(prompt, 'ANSWER') ?? ''
  const quote = lastSentence(answer)
  const level = /Level being judged against: (\w+)\./.exec(prompt)?.[1] ?? 'junior'
  const action = /The interviewer's move on this turn: ([A-Z_]+)/.exec(prompt)?.[1] as PolicyAction
  const file = /^FILE: (.+)$/m.exec(fenced(prompt, 'REPOSITORY') ?? '')?.[1]

  if (prompt.includes('The claim under interrogation')) {
    return {
      findings: [
        {
          kind: 'claim',
          verdict: 'partially_supported',
          rationale:
            file === undefined
              ? 'lease recovery is described; duplicate completion is not'
              : `the answer accounts for part of ${file}; what happens when two workers reach it at once is not described`,
          confidence: 0.8,
          quotes: [quote],
        },
      ],
    }
  }

  const competency = PROBES[action] ?? 'mechanism'
  if (answer.trim().split(/\s+/).length < 8) {
    return {
      findings: [
        {
          kind: 'competency_abstained',
          competency,
          abstention: 'insufficient_evidence',
          rationale:
            'The answer names the idea without describing it, so there is nothing to judge yet.',
          confidence: 0.6,
          quotes: [quote],
        },
      ],
    }
  }

  const unsure = /not sure|do not know|don't know|do not think|don't think/i.test(answer)
  const against = file === undefined ? '' : ` against ${file}`
  return {
    findings: [
      {
        kind: 'competency',
        competency,
        levelMet: unsure ? null : level,
        rationale: unsure
          ? `The answer states the core idea${against}, then stops where it says it is unsure; that missing part is what this level expects.`
          : `The answer explains the idea${against} in its own words, at the depth this level expects.`,
        confidence: 0.75,
        quotes: [quote],
      },
    ],
  }
}

class SubjectEvaluator implements EvaluatorPort {
  async complete<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<Static<T>>> {
    const value = request.promptId === 'claim-extraction' ? EXTRACTION : judge(request.user)
    // Keeps the script honest: a shape the real model could never return fails here too.
    if (!Value.Check(request.schema, value)) {
      const errors = [...Value.Errors(request.schema, value)].map((e) => `${e.path}: ${e.message}`)
      return {
        ok: false,
        failure: { kind: 'schema_mismatch', errors, raw: JSON.stringify(value) },
        invocation: fakeInvocation(),
      }
    }
    return { ok: true, value: value as Static<T>, invocation: fakeInvocation() }
  }
}

const WORKER_DELAY_MS = 1_500

// A durable queue and its worker in one process, for the journey that pins through a queue. The
// worker waits before leasing, so the browser has to poll the job rather than catch it finished.
function workerQueue(deps: { store: EventStore; clock: Clock; ids: IdSource }): JobQueuePort {
  const jobs = new Map<string, JobRecord>()
  const update = (jobId: string, change: Partial<JobRecord>) => {
    const job = jobs.get(jobId)
    if (job !== undefined) jobs.set(jobId, { ...job, ...change, updatedAt: deps.clock.now() })
  }
  const work = async (job: JobRecord) => {
    if (job.payload.kind !== 'ingest_repository') return
    update(job.id, { state: 'leased', attempts: 1, leaseOwner: 'e2e-worker' })
    try {
      await pinIsolated(deps, job.payload, DEFAULT_INGEST_LIMITS)
      update(job.id, { state: 'succeeded', leaseOwner: null })
    } catch (error) {
      update(job.id, { state: 'dead', leaseOwner: null, lastError: String(error) })
    }
  }
  const unused = async (): Promise<never> => {
    throw new Error('the in-process worker leases its own jobs')
  }

  return {
    async enqueue(input) {
      const now = deps.clock.now()
      const job: JobRecord = {
        id: deps.ids.next('job'),
        ownerId: input.ownerId,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        state: 'queued',
        attempts: 0,
        maxAttempts: 1,
        runAfter: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      jobs.set(job.id, job)
      setTimeout(() => void work(job), WORKER_DELAY_MS)
      return job
    },
    async get(jobId) {
      return jobs.get(jobId) ?? null
    },
    async list(ownerId, limit) {
      return [...jobs.values()]
        .filter((job) => job.ownerId === ownerId)
        .reverse()
        .slice(0, limit)
    },
    claim: unused,
    succeed: unused,
    retry: unused,
    bury: unused,
    release: unused,
  }
}

const port = Number(process.env.PORT ?? '3097')

const store = new MemoryEventStore()
const clock = new FixedClock()
const ids = new SeqIds()
const app = await buildApp(
  loadConfig({ PORT: String(port), LOG_LEVEL: 'fatal', LEVELHEAD_RATE_LIMIT_PER_MINUTE: '10000' }),
  {
    storeFor: () => store,
    clock,
    ids,
    conductor: new SubjectConductor(),
    evaluator: new SubjectEvaluator(),
    ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
    logger: silentLogger,
    queue: process.env.E2E_QUEUE === 'worker' ? workerQueue({ store, clock, ids }) : null,
    retrieval: null,
  },
)

await app.listen({ port, host: '127.0.0.1' })
process.stdout.write(`e2e server on ${port}\n`)
