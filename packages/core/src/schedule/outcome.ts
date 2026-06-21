import type { GapEntry } from '@closer/contracts'
import { applyTransferResult, type GapTransition } from '../gaps/ledger.ts'
import type { Clock } from '../ports/clock.ts'

export function applyRetrievalResult(
  gap: GapEntry,
  attemptId: string,
  passed: boolean,
  deps: { clock: Clock },
): { gap: GapEntry; transition: GapTransition | null } {
  // Only a closed row is ever retrieved (due.ts) — anything else reaching here is a caller mistake.
  if (gap.status !== 'closed_under_transfer') return { gap, transition: null }

  // Routed through the transfer path, not reimplemented here, so "closing requires a recorded
  // attempt" stays a single invariant. A failed retrieval reopens the gap.
  const settled = applyTransferResult(gap, attemptId, passed, deps)
  return {
    gap: {
      ...settled.gap,
      retrievals: [...(settled.gap.retrievals ?? []), { attemptId, at: deps.clock.now(), passed }],
    },
    transition: settled.transition,
  }
}
