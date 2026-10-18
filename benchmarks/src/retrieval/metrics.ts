export interface RankedHit {
  artifactId: string
  chunkId?: string
}

export interface RetrievalMetrics {
  precision: number | null
  recall: number | null
  reciprocalRank: number | null
  ndcg: number | null
  noAnswerFalseHits: number | null
}

/** Artifact judgments: collapse overlapping chunks before taking k; precision denominator is
 * always k, including when the strategy returns fewer than k distinct artifacts. */
export function score(
  hits: readonly RankedHit[],
  relevant: Readonly<Record<string, number>>,
  k: number,
): { artifactIds: string[]; metrics: RetrievalMetrics } {
  if (!Number.isSafeInteger(k) || k < 1) throw new Error('k must be a positive integer')
  const grades = Object.values(relevant)
  if (grades.some((grade) => !Number.isInteger(grade) || grade < 1 || grade > 3)) {
    throw new Error('Relevance grades must be integers from 1 to 3')
  }
  const artifactIds = [...new Set(hits.map((hit) => hit.artifactId))].slice(0, k)
  if (grades.length === 0) {
    return {
      artifactIds,
      metrics: {
        precision: null,
        recall: null,
        reciprocalRank: null,
        ndcg: null,
        noAnswerFalseHits: artifactIds.length,
      },
    }
  }
  let count = 0
  let first = 0
  let dcg = 0
  artifactIds.forEach((id, index) => {
    const grade = Object.hasOwn(relevant, id) ? relevant[id]! : 0
    if (grade > 0) {
      count++
      if (first === 0) first = 1 / (index + 1)
      dcg += (2 ** grade - 1) / Math.log2(index + 2)
    }
  })
  const ideal = [...grades]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0)
  return {
    artifactIds,
    metrics: {
      precision: count / k,
      recall: count / grades.length,
      reciprocalRank: first,
      ndcg: dcg / ideal,
      noAnswerFalseHits: null,
    },
  }
}
