import { silentLogger } from '@levelhead/core'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { JsonlEventStore } from '../../../cli/src/store/jsonl.ts'
import { RandomIds, SystemClock } from '../../../cli/src/runtime.ts'
import { ScriptedConductor, ScriptedEvaluator } from '../../../cli/src/testing/fakes.ts'

const root = process.env.RECOVERY_EVENT_DIR
if (!root) throw new Error('The restart test must provide its own temporary event directory')
const quote = 'A B-tree stores ordered keys and updates them on inserts.'
const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }), {
  storeFor: (owner) => new JsonlEventStore(root, typeof owner === 'string' ? owner : owner.ownerId),
  clock: new SystemClock(),
  ids: new RandomIds(),
  conductor: new ScriptedConductor(['Explain the index.', 'What changes on a write?']),
  evaluator: new ScriptedEvaluator([
    {
      findings: [
        {
          kind: 'competency',
          competency: 'mechanism',
          levelMet: 'junior',
          rationale: 'Describes the keys.',
          confidence: 0.8,
          quotes: [quote],
        },
      ],
    },
  ]),
  ceilings: { sessionCostUsd: 2, sessionTokens: 120000, modelCallsPerTurn: 3 },
  logger: silentLogger,
  queue: null,
  retrieval: null,
})
await app.listen({ host: '127.0.0.1', port: Number(process.env.RECOVERY_PORT ?? 0) })
const address = app.server.address()
if (address === null || typeof address === 'string')
  throw new Error('Expected a loopback TCP listener')
process.stdout.write(`RECOVERY_PORT=${address.port}\n`)
process.on('SIGTERM', () => {
  void app.close().then(() => process.exit(0))
})
