import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { JsonlEventStore } from '../../cli/src/store/jsonl.ts'
import { SystemClock } from '../../cli/src/runtime.ts'
import { loadCliConfig } from '../../cli/src/config.ts'
import { agentInterfaceGate } from './gate.ts'
import { buildMcpServer } from './server.ts'

const REPORTS_DIR = process.env.CLOSER_BENCHMARK_DIR ?? '.closer/benchmarks'

const gate = await agentInterfaceGate(REPORTS_DIR)
if (!gate.open) {
  process.stderr.write(
    [
      'The CLOSER agent interface is gated behind the benchmark beating a baseline (ADR-011).',
      `It is closed: ${gate.reason}`,
      '',
      'This is not a configuration error and there is no flag that opens it. Run the benchmark',
      'against a real provider, publish the report, and this starts on its own.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const config = loadCliConfig()
const server = buildMcpServer({
  store: new JsonlEventStore(config.eventDir, config.ownerId),
  now: () => new SystemClock().now(),
  gate,
})

process.stderr.write(`closer mcp ready — gate opened by ${gate.runId ?? 'unknown run'}\n`)
await server.connect(new StdioServerTransport())
