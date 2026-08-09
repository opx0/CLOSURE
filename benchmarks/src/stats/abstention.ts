// El-Yaniv & Wiener (2010) risk-coverage trade-off; Geifman & El-Yaniv (2017) AURC. Curve, AURC and
// fixed-coverage accuracy are all reported together because a fixed-rate metric and a curve metric
// are gameable in opposite directions (Hendrickx et al. 2024) — an evaluator that abstains on
// everything hard posts near-perfect accuracy at near-zero coverage otherwise (Research §3).

export type SelectiveItem = { confidence: number; correct: boolean }

export type RiskCoveragePoint = { coverage: number; risk: number }

export type RiskCoverage = {
  curve: readonly RiskCoveragePoint[]
  aurc: number
}

// Fixed 2026-09-06, before any benchmark run existed (ticket 05 §5) — only allowed to move upward,
// and only before the run that tests them (§7).
export const FIXED_COVERAGE_LEVELS = [0.7, 0.85] as const

// Stable sort, ties in input order — a run of tied confidences is one indivisible operating point.
const byConfidenceDescending = (items: readonly SelectiveItem[]): SelectiveItem[] =>
  [...items].sort((a, b) => b.confidence - a.confidence)

export function riskCoverage(items: readonly SelectiveItem[]): RiskCoverage {
  const n = items.length
  if (n === 0) return { curve: [], aurc: NaN }

  const ordered = byConfidenceDescending(items)
  const curve: RiskCoveragePoint[] = []
  let errors = 0
  let riskSum = 0
  for (let k = 0; k < n; k += 1) {
    if (!(ordered[k] as SelectiveItem).correct) errors += 1
    const risk = errors / (k + 1)
    riskSum += risk
    curve.push({ coverage: (k + 1) / n, risk })
  }

  // Mean selective risk over the n realisable coverage levels — trapezoidal integration over
  // coverage would give a different number for the same curve, so the convention is fixed here.
  return { curve, aurc: riskSum / n }
}

export function accuracyAtCoverage(items: readonly SelectiveItem[], coverage: number): number {
  if (!(Number.isFinite(coverage) && coverage >= 0 && coverage <= 1)) {
    throw new RangeError(`coverage must be in [0, 1], got ${coverage}`)
  }
  const n = items.length
  const covered = Math.round(coverage * n)
  // Nothing covered has no accuracy to report — returning 1 (vacuously right about the empty set)
  // would be the exact flattery this file exists to block.
  if (covered < 1) return NaN

  const ordered = byConfidenceDescending(items)
  let correct = 0
  for (let k = 0; k < covered; k += 1) {
    if ((ordered[k] as SelectiveItem).correct) correct += 1
  }
  return correct / covered
}
