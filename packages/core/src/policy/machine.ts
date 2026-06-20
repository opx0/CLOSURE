import type { SessionState } from '@closer/contracts'

// Facts about what happened, not commands — the machine is driven by the same events the log
// records, so a replayed session walks the same path as a live one.
export type SessionTrigger =
  | 'action_selected'
  | 'question_rendered'
  | 'answer_received'
  | 'observations_recorded'
  | 'evaluation_deferred'
  | 'evaluation_produced'
  | 'retry_requested'
  | 'drill_started'
  | 'drill_skipped'
  | 'session_closed'

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: SessionState,
    readonly trigger: SessionTrigger,
  ) {
    super(`illegal transition: cannot ${trigger} from ${from}`)
    this.name = 'IllegalTransitionError'
  }
}

// This table is the specification (Ticket 19) — an illegal sequence like evaluating before an
// answer exists is a type error here, not a runtime bug.
export const LEGAL_TRANSITIONS: Record<
  SessionState,
  Partial<Record<SessionTrigger, SessionState>>
> = {
  selecting: { action_selected: 'asking', session_closed: 'closed' },
  asking: { question_rendered: 'awaiting_answer', session_closed: 'closed' },
  awaiting_answer: { answer_received: 'observing', session_closed: 'closed' },
  observing: {
    observations_recorded: 'evaluating',
    // Simulation withholds feedback until end of section (§4.4) — a legal path, not a skipped step.
    evaluation_deferred: 'selecting',
    session_closed: 'closed',
  },
  evaluating: {
    evaluation_produced: 'selecting',
    // Coach offers a retry of the same question after feedback (§4.9).
    retry_requested: 'asking',
    // §4.5: one focused drill for the gap, immediately after the section.
    drill_started: 'drilling',
    session_closed: 'closed',
  },
  // Corrective practice, not another arc turn — a drill is asked and answered inside this state.
  drilling: {
    answer_received: 'observing',
    drill_skipped: 'selecting',
    session_closed: 'closed',
  },
  // Terminal. A closed session is replayed, never resumed.
  closed: {},
}

export function canTransition(state: SessionState, trigger: SessionTrigger): boolean {
  return LEGAL_TRANSITIONS[state][trigger] !== undefined
}

export function transition(state: SessionState, trigger: SessionTrigger): SessionState {
  const next = LEGAL_TRANSITIONS[state][trigger]
  if (next === undefined) throw new IllegalTransitionError(state, trigger)
  return next
}
