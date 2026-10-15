import { AUDIT_BOUNDARY, type AuditDelta, type BlindTransform } from './blind.ts'

export interface BlindComparison {
  readonly attemptId: string
  readonly variantId: string
  readonly transforms: readonly BlindTransform[]
  readonly delta: AuditDelta
}

export interface BlindAuditReport {
  // n. The count of distinct answers re-run, not the count of comparisons, because one answer
  // rewritten four ways is one answer.
  readonly answersReplayed: number
  readonly comparisons: number
  readonly findingsCompared: number
  readonly verdictChanges: number
  readonly abstentionChanges: number
  readonly largestConfidenceShift: number
  // Carried as a value rather than printed once, so the caveat survives every surface the report
  // travels to — the CLI, the HTTP API, an export bundle.
  readonly limitation: string
  readonly boundary: typeof AUDIT_BOUNDARY
}

export function limitationFor(answersReplayed: number): string {
  return (
    `n is ${answersReplayed}. A difference across ${answersReplayed} ` +
    `${answersReplayed === 1 ? 'answer' : 'answers'} establishes nothing about bias in either ` +
    'direction, and neither does an absence of one. This is a description of what moved, not a ' +
    'finding about the Evaluator.'
  )
}

export function blindAuditReport(comparisons: readonly BlindComparison[]): BlindAuditReport {
  const answersReplayed = new Set(comparisons.map((comparison) => comparison.attemptId)).size

  return {
    answersReplayed,
    comparisons: comparisons.length,
    findingsCompared: comparisons.reduce((total, one) => total + one.delta.compared, 0),
    verdictChanges: comparisons.reduce((total, one) => total + one.delta.verdictChanges, 0),
    abstentionChanges: comparisons.reduce((total, one) => total + one.delta.abstentionChanges, 0),
    largestConfidenceShift: comparisons.reduce(
      (largest, one) => Math.max(largest, one.delta.largestConfidenceShift),
      0,
    ),
    limitation: limitationFor(answersReplayed),
    boundary: AUDIT_BOUNDARY,
  }
}

export function renderBlindAudit(report: BlindAuditReport): string[] {
  return [
    "blind-replay audit — Levelhead's honesty check, pointed at Levelhead",
    `  answers replayed          ${report.answersReplayed}`,
    `  comparisons               ${report.comparisons} over ${report.findingsCompared} paired findings`,
    `  verdicts that changed     ${report.verdictChanges}`,
    `  abstentions that changed  ${report.abstentionChanges}`,
    `  largest confidence move   ${report.largestConfidenceShift.toFixed(2)}`,
    `  ${report.limitation}`,
    '  Every base and variant transcript is published in full, with its prompt hash and model',
    '  alias, so a reader can check this rather than take it.',
  ]
}
