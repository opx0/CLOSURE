import type { AnyEvent } from '@closer/contracts'

// Append-only is what makes replay possible — each adapter enforces it itself (O_APPEND in JSONL, a
// unique constraint + trigger in Postgres), not this interface.
export interface EventStore {
  // Rejects a duplicate (sessionId, seq) rather than overwriting — a hole or rewrite is corruption, not recoverable state.
  append(event: AnyEvent): Promise<void>
  read(sessionId: string): Promise<AnyEvent[]>
  listSessions(): Promise<string[]>
}

export class AppendOnlyViolation extends Error {
  constructor(
    readonly sessionId: string,
    readonly seq: number,
  ) {
    super(`event ${sessionId}#${seq} already exists; the log is append-only`)
    this.name = 'AppendOnlyViolation'
  }
}
