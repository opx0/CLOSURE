import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { JobRecord } from '@closer/contracts'
import type { HandlerContext } from './context.ts'

const BENCHMARK_CLI = fileURLToPath(new URL('../../../../benchmarks/src/cli.ts', import.meta.url))

// The heaviest workload runs here rather than in an HTTP request because it is long, offline, and
// must survive a restart. Nothing about its result is interpreted here: the report is the output.
export async function runBenchmark(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'run_benchmark') throw new Error('wrong payload for benchmark run')
  const payload = job.payload

  const args = [
    BENCHMARK_CLI,
    '--fixtures',
    payload.fixturesDir,
    '--out',
    payload.outDir,
    '--ports',
    payload.portsModule,
    '--bar',
    payload.bar,
    ...(payload.labelsFile === undefined ? [] : ['--labels', payload.labelsFile]),
  ]

  const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.once('error', reject)
      child.once('close', (code) =>
        resolve({
          code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        }),
      )
    },
  )

  if (output.code !== 0) {
    throw new Error(`benchmark exited ${String(output.code)}: ${output.stderr.slice(0, 500)}`)
  }

  context.logger.log('info', 'benchmark run finished', {
    jobId: job.id,
    ownerId: job.ownerId,
    outDir: payload.outDir,
    bar: payload.bar,
  })
}
