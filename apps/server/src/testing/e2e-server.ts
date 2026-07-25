import { silentLogger } from '@closer/core'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import {
  FixedClock,
  MemoryEventStore,
  ScriptedConductor,
  ScriptedEvaluator,
  SeqIds,
} from '../../../cli/src/testing/fakes.ts'

// The real HTTP surface and the real built client, with scripted model ports behind them. The
// browser journey must exercise CLOSER's own wiring, not a provider's availability — and a live
// model in an end-to-end test measures the model, not the product.

const RESUME_QUOTE = 'Built a durable job queue on PostgreSQL'
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

const port = Number(process.env.PORT ?? '3097')

const store = new MemoryEventStore()
const app = await buildApp(loadConfig({ PORT: String(port), LOG_LEVEL: 'fatal' }), {
  storeFor: () => store,
  clock: new FixedClock(),
  ids: new SeqIds(),
  conductor: new ScriptedConductor([
    'walk me through how a job is claimed',
    'and what stops it completing twice?',
    'so the database guarantees that on its own, right?',
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
    judged,
  ]),
  ceilings: { sessionCostUsd: 2, sessionTokens: 120_000, modelCallsPerTurn: 3 },
  logger: silentLogger,
  queue: null,
  retrieval: null,
})

await app.listen({ port, host: '127.0.0.1' })
process.stdout.write(`e2e server on ${port}\n`)
