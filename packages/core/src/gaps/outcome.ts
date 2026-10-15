import type { GapEntry, PracticeOutcome, PracticeReceipt } from '@levelhead/contracts'

export type PracticeOutcomeFailure =
  | { kind: 'wrong_gap'; expected: string; received: string }
  | { kind: 'attempt_conflict'; original: PracticeReceipt; incoming: PracticeReceipt }
  | { kind: 'legacy_attempt'; attemptId: string }
  | { kind: 'retrieval_not_closed'; status: GapEntry['status'] }

export type PracticeOutcomeResult =
  | { kind: 'applied'; gap: GapEntry }
  | { kind: 'duplicate'; gap: Readonly<GapEntry> }
  | { kind: 'rejected'; failure: PracticeOutcomeFailure }

export class PracticeOutcomeError extends Error {
  constructor(readonly failure: PracticeOutcomeFailure) {
    super(`practice outcome rejected: ${failure.kind}`)
    this.name = 'PracticeOutcomeError'
  }
}

export function applyPracticeOutcome(input: {
  gap: Readonly<GapEntry>
  outcome: PracticeOutcome & { occurredAt: string }
}): PracticeOutcomeResult {
  const { gap, outcome } = input
  if (outcome.gapId !== gap.id) {
    return {
      kind: 'rejected',
      failure: { kind: 'wrong_gap', expected: gap.id, received: outcome.gapId },
    }
  }
  const incoming: PracticeReceipt = {
    attemptId: outcome.attemptId,
    kind: outcome.kind,
    held: outcome.held,
  }
  const original = gap.practiceReceipts?.find((receipt) => receipt.attemptId === outcome.attemptId)
  if (original !== undefined) {
    return original.kind === incoming.kind && original.held === incoming.held
      ? { kind: 'duplicate', gap }
      : { kind: 'rejected', failure: { kind: 'attempt_conflict', original, incoming } }
  }
  if (
    gap.transferAttemptIds.includes(outcome.attemptId) ||
    gap.retrievals?.some((retrieval) => retrieval.attemptId === outcome.attemptId)
  ) {
    return { kind: 'rejected', failure: { kind: 'legacy_attempt', attemptId: outcome.attemptId } }
  }
  if (outcome.kind === 'retrieval' && gap.status !== 'closed_under_transfer') {
    return { kind: 'rejected', failure: { kind: 'retrieval_not_closed', status: gap.status } }
  }

  const touched: GapEntry = {
    ...gap,
    lastTouchedAt: outcome.occurredAt,
    practiceReceipts: [...(gap.practiceReceipts ?? []), incoming],
  }
  switch (outcome.kind) {
    case 'drill':
      return {
        kind: 'applied',
        gap: { ...touched, status: outcome.held && gap.status === 'open' ? 'drilled' : gap.status },
      }
    case 'transfer':
      return {
        kind: 'applied',
        gap: {
          ...touched,
          status: outcome.held ? 'closed_under_transfer' : 'open',
          transferAttemptIds: [...gap.transferAttemptIds, outcome.attemptId],
        },
      }
    case 'retrieval':
      return {
        kind: 'applied',
        gap: {
          ...touched,
          status: outcome.held ? 'closed_under_transfer' : 'open',
          retrievals: [
            ...(gap.retrievals ?? []),
            { attemptId: outcome.attemptId, at: outcome.occurredAt, passed: outcome.held },
          ],
        },
      }
    default: {
      const exhaustive: never = outcome.kind
      return exhaustive
    }
  }
}
