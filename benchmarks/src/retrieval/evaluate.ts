import type { RetrievalCase } from './cases.ts'
import { score, type RankedHit, type RetrievalMetrics } from './metrics.ts'

export type RetrievalStrategy = (query: RetrievalCase, k: number) => Promise<readonly RankedHit[]>

export interface EvaluationRow {
  strategy: string
  caseId: string
  split: RetrievalCase['split']
  artifactIds: string[]
  returnedHits: number
  elapsedMs: number
  metrics: RetrievalMetrics | null
  error: string | null
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarize(results: readonly EvaluationRow[]) {
  return [...new Set(results.map((row) => row.strategy))].flatMap((strategy) =>
    (['tuning', 'heldout'] as const).flatMap((split) => {
      const rows = results.filter((row) => row.strategy === strategy && row.split === split)
      if (rows.length === 0) return []
      const answered = rows.filter((row) => row.metrics?.precision != null)
      const noAnswer = rows.filter((row) => row.metrics?.noAnswerFalseHits != null)
      return [
        {
          strategy,
          split,
          queries: rows.length,
          failures: rows.filter((row) => row.error !== null).length,
          answerable: answered.length,
          noAnswer: noAnswer.length,
          precision: mean(answered.map((row) => row.metrics!.precision!)),
          recall: mean(answered.map((row) => row.metrics!.recall!)),
          mrr: mean(answered.map((row) => row.metrics!.reciprocalRank!)),
          ndcg: mean(answered.map((row) => row.metrics!.ndcg!)),
          noAnswerFalseHitRate: mean(
            noAnswer.map((row) => Number(row.metrics!.noAnswerFalseHits! > 0)),
          ),
          noAnswerMeanFalseHits: mean(noAnswer.map((row) => row.metrics!.noAnswerFalseHits!)),
          meanElapsedMs: mean(rows.map((row) => row.elapsedMs)),
        },
      ]
    }),
  )
}

function compare(results: readonly EvaluationRow[], baseline: string | undefined) {
  if (!baseline) return []
  const baseRows = new Map(
    results.filter((row) => row.strategy === baseline).map((row) => [row.caseId, row]),
  )
  return results
    .filter((row) => row.strategy !== baseline)
    .map((row) => {
      const base = baseRows.get(row.caseId)!
      const delta = (key: keyof RetrievalMetrics): number | null => {
        const value = row.metrics?.[key]
        const baseValue = base.metrics?.[key]
        return value == null || baseValue == null ? null : value - baseValue
      }
      return {
        caseId: row.caseId,
        split: row.split,
        baseline,
        candidate: row.strategy,
        baselineError: base.error,
        candidateError: row.error,
        precisionDelta: delta('precision'),
        recallDelta: delta('recall'),
        reciprocalRankDelta: delta('reciprocalRank'),
        ndcgDelta: delta('ndcg'),
        noAnswerFalseHitsDelta: delta('noAnswerFalseHits'),
        elapsedMsDelta: row.error || base.error ? null : row.elapsedMs - base.elapsedMs,
      }
    })
}

/** Pure strategy seam; failures remain explicit rows and make the complete run unsuccessful.
 * A supplied clock makes even timings deterministic in tests. Production uses performance.now. */
export async function evaluate(input: {
  cases: readonly RetrievalCase[]
  strategies: Readonly<Record<string, RetrievalStrategy>>
  k: number
  clock?: () => number
  baseline?: string
}) {
  if (!Number.isSafeInteger(input.k) || input.k < 1) throw new Error('k must be a positive integer')
  if (input.cases.length === 0) throw new Error('At least one evaluation case is required')
  if (new Set(input.cases.map((query) => query.id)).size !== input.cases.length) {
    throw new Error('Duplicate evaluation case IDs')
  }
  if (Object.keys(input.strategies).length === 0)
    throw new Error('At least one strategy is required')
  if (input.baseline && !Object.hasOwn(input.strategies, input.baseline))
    throw new Error('Unknown baseline strategy')
  const clock = input.clock ?? (() => performance.now())
  const results: EvaluationRow[] = []
  for (const strategy of Object.keys(input.strategies).sort()) {
    for (const query of input.cases) {
      const start = clock()
      try {
        const hits = await input.strategies[strategy]!(query, input.k)
        const scored = score(hits, query.relevant, input.k)
        results.push({
          strategy,
          caseId: query.id,
          split: query.split,
          ...scored,
          returnedHits: hits.length,
          elapsedMs: clock() - start,
          error: null,
        })
      } catch (error) {
        results.push({
          strategy,
          caseId: query.id,
          split: query.split,
          artifactIds: [],
          returnedHits: 0,
          elapsedMs: clock() - start,
          metrics: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return {
    k: input.k,
    success: results.every((row) => row.error === null),
    results,
    summaries: summarize(results),
    comparisons: compare(results, input.baseline),
  }
}
