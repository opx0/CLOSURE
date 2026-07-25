import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ErrorSchema } from './shared.ts'

const REPORT_FILE = 'report.json'

const SummarySchema = Type.Object({
  runId: Type.String({ minLength: 1 }),
  startedAt: Type.String(),
  syntheticFixtureData: Type.Boolean(),
  claimsPermitted: Type.Boolean(),
  claimsPermittedReason: Type.String(),
  arms: Type.Array(Type.String()),
  gates: Type.Array(
    Type.Object({
      id: Type.String(),
      status: Type.String(),
      threshold: Type.String(),
      observed: Type.Union([Type.Number(), Type.Null()]),
      reason: Type.String(),
    }),
  ),
  stopConditions: Type.Array(Type.Object({ id: Type.String(), status: Type.String() })),
})

interface StoredReport {
  manifest: { runId: string; startedAt: string; arms: string[] }
  syntheticFixtureData: boolean
  gates: {
    results: {
      id: string
      status: string
      threshold: string
      observed: number | null
      reason: string
    }[]
    claimsPermitted: boolean
    claimsPermittedReason: string
  }
  stopConditions: { id: string; status: string }[]
}

// Every run publishes in full with no editorial step (ticket 05 §7), so this serves what is on
// disk and never filters, ranks, or summarises a failing gate away.
export function benchmarkRoutes(reportsDir: string): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/benchmark/runs',
      {
        schema: {
          summary: 'Every published benchmark run, failures included',
          tags: ['benchmark'],
          response: { 200: Type.Object({ runs: Type.Array(SummarySchema) }) },
        },
      },
      async () => {
        let entries: string[]
        try {
          entries = await readdir(reportsDir)
        } catch {
          return { runs: [] }
        }

        const runs = []
        for (const entry of entries.sort()) {
          try {
            const raw = await readFile(join(reportsDir, entry, REPORT_FILE), 'utf8')
            const report = JSON.parse(raw) as StoredReport
            runs.push({
              runId: report.manifest.runId,
              startedAt: report.manifest.startedAt,
              syntheticFixtureData: report.syntheticFixtureData,
              claimsPermitted: report.gates.claimsPermitted,
              claimsPermittedReason: report.gates.claimsPermittedReason,
              arms: report.manifest.arms,
              gates: report.gates.results,
              stopConditions: report.stopConditions,
            })
          } catch {
            continue
          }
        }
        return { runs }
      },
    )

    app.get(
      '/benchmark/runs/:id',
      {
        schema: {
          summary: 'One run in full: manifest, transcripts, per-item outcomes, gates',
          tags: ['benchmark'],
          params: Type.Object({ id: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }) }),
          response: { 200: Type.Unknown(), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        try {
          const raw = await readFile(join(reportsDir, request.params.id, REPORT_FILE), 'utf8')
          return JSON.parse(raw) as unknown
        } catch {
          return reply.code(404).send({ error: 'no such run', detail: request.params.id })
        }
      },
    )
  }
}
