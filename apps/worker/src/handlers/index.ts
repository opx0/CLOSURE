import type { JobKind, JobRecord } from '@closer/contracts'
import type { HandlerContext } from './context.ts'
import { buildExport } from './build-export.ts'
import { ingestRepository } from './ingest-repository.ts'
import { planRetrieval } from './plan-retrieval.ts'
import { runBenchmark } from './run-benchmark.ts'
import { sweepRetention } from './sweep-retention.ts'

export * from './context.ts'

export type JobHandler = (job: JobRecord, context: HandlerContext) => Promise<void>

export const HANDLERS: Record<JobKind, JobHandler> = {
  ingest_repository: ingestRepository,
  build_export: buildExport,
  sweep_retention: sweepRetention,
  plan_retrieval: planRetrieval,
  run_benchmark: runBenchmark,
}
