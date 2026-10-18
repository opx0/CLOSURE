import type { RetrievalHit } from '../ports/retrieval.ts'
import { integerBound } from './chunks.ts'

export function reciprocalRankFusion(
  lexical: readonly RetrievalHit[],
  dense: readonly RetrievalHit[],
  limit: number,
  rankConstant = 60,
): RetrievalHit[] {
  integerBound(limit, 'limit', 0)
  if (!Number.isFinite(rankConstant) || rankConstant <= 0)
    throw new RangeError('rankConstant must be finite and positive')
  const fused = new Map<string, { hit: RetrievalHit; score: number }>()
  for (const branch of [lexical, dense]) {
    const seen = new Set<string>()
    // Rank unique artifacts in branch order, so duplicate chunks cannot dilute later votes.
    let rank = 0
    for (const hit of branch) {
      const id = hit.artifact.id
      if (seen.has(id)) continue
      seen.add(id)
      rank++
      const previous = fused.get(id)
      // Dense metadata identifies the exact retrieved chunk; lexical raw scores are never added.
      fused.set(id, { hit, score: (previous?.score ?? 0) + 1 / (rankConstant + rank) })
    }
  }
  return [...fused.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.hit.artifact.id < b.hit.artifact.id
          ? -1
          : a.hit.artifact.id > b.hit.artifact.id
            ? 1
            : 0),
    )
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, rank: score }))
}
