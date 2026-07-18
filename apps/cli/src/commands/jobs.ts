import { Pool } from 'pg'
import { PostgresJobQueue, idempotencyKeyFor } from '@closer/db'
import type { JobKind } from '@closer/contracts'
import { loadCliConfig } from '../config.ts'
import { RandomIds } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// Durable work only. Nothing an interview turn does is enqueued — a queue between a question and
// its answer would put a lease timeout inside a conversation.
export async function jobs(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  if (config.databaseUrl === undefined) {
    line('the job table lives in Postgres — set DATABASE_URL, then: bun run db:migrate')
    return 1
  }

  const pool = new Pool({ connectionString: config.databaseUrl })
  const ids = new RandomIds()
  const queue = new PostgresJobQueue(pool, () => ids.next('job'))

  try {
    const enqueue = flag(argv, 'enqueue') as JobKind | undefined
    if (enqueue !== undefined) {
      const payload = ((): Record<string, unknown> => {
        switch (enqueue) {
          case 'ingest_repository':
            return {
              kind: enqueue,
              repoPath: flag(argv, 'repo') ?? process.cwd(),
              ref: flag(argv, 'ref') ?? 'HEAD',
              sessionId: 'repo',
            }
          case 'build_export':
            return { kind: enqueue, destination: flag(argv, 'out') ?? config.ownerId }
          case 'sweep_retention':
            return { kind: enqueue, snapshotMaxAgeDays: Number(flag(argv, 'days') ?? '90') }
          case 'plan_retrieval':
            return { kind: enqueue, horizonDays: Number(flag(argv, 'horizon') ?? '7') }
          case 'run_benchmark':
            return {
              kind: enqueue,
              fixturesDir: flag(argv, 'fixtures') ?? 'fixtures/benchmark',
              outDir: flag(argv, 'out') ?? '.closer/benchmarks',
              portsModule: flag(argv, 'ports') ?? 'apps/cli/src/benchmark-ports.ts',
              bar: flag(argv, 'bar') === 'flagship' ? 'flagship' : 'self_use',
            }
          default:
            throw new Error(`unknown job kind ${String(enqueue)}`)
        }
      })()

      const job = await queue.enqueue({
        ownerId: config.ownerId,
        kind: enqueue,
        payload: payload as never,
        idempotencyKey: idempotencyKeyFor(enqueue, [new Date().toISOString()]),
      })
      heading('queued')
      line(`  ${job.id}  ${job.kind}`)
      dim(`  run it with: bun run worker`)
      return 0
    }

    const listed = await queue.list(config.ownerId, Number(flag(argv, 'limit') ?? '25'))
    heading('jobs')
    if (listed.length === 0) {
      dim('  none queued.')
      return 0
    }
    for (const job of listed) {
      line(`  ${job.state.padEnd(10)} ${job.kind.padEnd(18)} ${job.id}`)
      dim(
        `    attempt ${job.attempts}/${job.maxAttempts} · run after ${job.runAfter.slice(0, 19)}${job.lastError === null ? '' : ` · last error: ${job.lastError.slice(0, 120)}`}`,
      )
    }
    return 0
  } finally {
    await pool.end()
  }
}
