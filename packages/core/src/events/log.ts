import {
  EVENT_SCHEMA_VERSION,
  type AnyEvent,
  type EventKind,
  type EventOf,
} from '@closer/contracts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { EventStore } from '../ports/event-store.ts'
import { assertValidEvent } from './validate.ts'

export interface SessionLogDeps {
  store: EventStore
  clock: Clock
  ids: IdSource
}

// The only writer in the system — a second seq allocator would race this one. Ids/timestamps come
// from ports so replay stays deterministic (ticket 05 §3).
export class SessionLog {
  readonly #deps: SessionLogDeps
  readonly #sessionId: string
  readonly #events: AnyEvent[]
  #nextSeq: number

  private constructor(deps: SessionLogDeps, sessionId: string, existing: readonly AnyEvent[]) {
    this.#deps = deps
    this.#sessionId = sessionId
    this.#events = [...existing]
    this.#nextSeq = existing.reduce((highest, event) => Math.max(highest, event.seq), -1) + 1
  }

  // Reopening continues the existing log; restarting seq at 0 would collide with what's on disk.
  static async open(deps: SessionLogDeps, sessionId: string): Promise<SessionLog> {
    return new SessionLog(deps, sessionId, await deps.store.read(sessionId))
  }

  get sessionId(): string {
    return this.#sessionId
  }

  async append<K extends EventKind>(
    kind: K,
    payload: EventOf<K>['payload'],
    causedBy?: string,
  ): Promise<EventOf<K>> {
    const candidate: unknown = {
      eventId: this.#deps.ids.next('evt'),
      sessionId: this.#sessionId,
      seq: this.#nextSeq,
      occurredAt: this.#deps.clock.now(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      kind,
      payload,
      // Spread, not `causedBy: causedBy` — under exactOptionalPropertyTypes an explicit undefined
      // would survive into the JSON line.
      ...(causedBy === undefined ? {} : { causedBy }),
    }
    assertValidEvent(candidate, `${this.#sessionId}#${this.#nextSeq} (${kind})`)
    const event = candidate as EventOf<K>

    // Seq advances only after the store accepts the write, so a rejected append leaves no hole.
    await this.#deps.store.append(event)
    this.#events.push(event)
    this.#nextSeq += 1
    return event
  }

  events(): readonly AnyEvent[] {
    return [...this.#events]
  }
}
