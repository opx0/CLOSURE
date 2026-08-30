import { silentLogger } from '@closer/core'
import { buildApp } from '../apps/server/src/app.ts'
import { loadConfig } from '../apps/server/src/config.ts'
import {
  FixedClock,
  MemoryEventStore,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
} from '../apps/cli/src/testing/fakes.ts'

// A cold-start proof, not a test: it drives the real HTTP surface with scripted model ports, so it
// runs with no provider, no container and no key, and it fails loudly if the wiring is broken.
// Nothing it prints is a measurement — the model is a script, and a script's outputs are a property
// of the script.

const RESUME = 'Built a durable job queue on PostgreSQL processing ~10k jobs/day.\n'
const RESUME_QUOTE = 'Built a durable job queue on PostgreSQL'
const ANSWER = 'We leased each job for thirty seconds. I do not think we handled double completion.'
const ANSWER_QUOTE = 'I do not think we handled double completion'

const judged = {
  findings: [
    {
      kind: 'claim',
      verdict: 'partially_supported',
      rationale: 'lease recovery is described; duplicate completion is not',
      confidence: 0.8,
      quotes: [ANSWER_QUOTE],
    },
  ],
}

const checks: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

const store = new MemoryEventStore()
const app = await buildApp(loadConfig({ LOG_LEVEL: 'fatal', CLOSER_WEB_DIST: 'apps/web/dist' }), {
  storeFor: () => store,
  clock: new FixedClock(),
  ids: new SeqIds(),
  conductor: new ScriptedConductor([
    'walk me through how a job is claimed',
    'and what stops it completing twice?',
  ]),
  evaluator: new ScriptedEvaluator([
    {
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
    },
    judged,
    judged,
  ]),
  ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
  logger: silentLogger,
  queue: null,
  retrieval: null,
})
await app.ready()

const health = await app.inject({ method: 'GET', url: '/health' })
check('health', health.statusCode === 200, `HTTP ${health.statusCode}`)

const extracted = await app.inject({
  method: 'POST',
  url: '/claims',
  payload: { resumeText: RESUME },
})
const claims = extracted.json() as { claims: { id: string; assertion: string }[] }
const claimId = claims.claims[0]?.id ?? ''
check('claims extracted with byte-exact spans', claimId !== '', claims.claims[0]?.assertion ?? '—')

await app.inject({
  method: 'POST',
  url: `/claims/${claimId}/confirm`,
  payload: { confirmed: true },
})

const started = await app.inject({
  method: 'POST',
  url: '/sessions',
  payload: { mode: 'coach', turnsPerRound: 2, drill: false },
})
const start = started.json() as { sessionId: string; question?: { text: string; action: string } }
check(
  'interview started, question chosen by code',
  started.statusCode === 201 && start.question !== undefined,
  `${start.question?.action ?? '—'}: ${start.question?.text ?? '—'}`,
)

const answered = await app.inject({
  method: 'POST',
  url: `/sessions/${start.sessionId}/answers`,
  payload: { text: ANSWER },
})
const turn = answered.json() as {
  findings: { rationale: string; evidenceIds: string[] }[]
  quotes: { evidenceId: string; quoted: string }[]
}
const cited = turn.findings[0]?.evidenceIds
  .map((id) => turn.quotes.find((quote) => quote.evidenceId === id)?.quoted)
  .filter((quoted): quoted is string => quoted !== undefined)
check(
  'finding cites the candidate’s own words',
  (cited?.length ?? 0) > 0,
  cited?.[0] ?? 'nothing resolved',
)

const replayed = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/replay` })
const replay = replayed.json() as { events: number; spansChecked: number }
check(
  'replay re-checks every citation byte-for-byte',
  replayed.statusCode === 200,
  `${replay.events} events, ${replay.spansChecked} citations`,
)

const ledger = await app.inject({ method: 'GET', url: '/ledger' })
const gaps = ledger.json() as { gaps: unknown[]; unresolvedCitations: number }
check(
  'gap ledger, no aggregate anywhere',
  gaps.unresolvedCitations === 0,
  `${gaps.gaps.length} gaps, ${gaps.unresolvedCitations} unresolved citations`,
)

const exported = await app.inject({ method: 'GET', url: '/export' })
const bundle = exported.json() as { sessions: unknown[] }
check(
  'export returns everything held',
  exported.statusCode === 200,
  `${bundle.sessions.length} sessions`,
)

const catalog = await app.inject({ method: 'GET', url: '/actions' })
const actions = catalog.json() as { actions: unknown[] }
check(
  'policy is inspectable',
  actions.actions.length > 0,
  `${actions.actions.length} typed actions`,
)

await app.close()

for (const one of checks) {
  process.stdout.write(`${one.ok ? '✓' : '✗'} ${one.name}\n  ${one.detail}\n`)
}
const failed = checks.filter((one) => !one.ok)
process.stdout.write(
  failed.length === 0
    ? '\nthe loop runs end to end. none of the above is a measurement — the model here is a script.\n'
    : `\n${failed.length} checks failed.\n`,
)
process.exit(failed.length === 0 ? 0 : 1)
