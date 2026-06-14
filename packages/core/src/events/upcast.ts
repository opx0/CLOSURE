import { EVENT_SCHEMA_VERSION, type AnyEvent, type EventKind } from '@closer/contracts'
import { assertValidEvent } from './validate.ts'

// STACK §6: a breaking payload change requires an upcaster registered alongside the schema, plus a
// replay test that reads a fixture written under the old version. An append-only log cannot be
// migrated in place — the rows are the record — so the only way a schema may move is if the old
// shape can still be read.
//
// The registry is empty, and that is the correct state: the event schema is still at version 1 and
// nothing has broken. What matters is that the seam exists before it is needed, because the day it
// is needed the old rows already exist.

export interface Upcaster {
  kind: EventKind
  from: number
  to: number
  // Takes the payload as it was written and returns it as the next version expects. Never mutates
  // its argument: the caller may still hold the original for comparison.
  upcast(payload: unknown): unknown
}

export type UpcastRegistry = readonly Upcaster[]

export const UPCASTERS: UpcastRegistry = []

export class UpcastGap extends Error {
  constructor(
    readonly kind: string,
    readonly from: number,
    readonly to: number,
  ) {
    super(
      `no upcaster from ${kind} schema version ${from} to ${to}; an old event cannot be read, and an append-only log cannot be rewritten to fix that`,
    )
    this.name = 'UpcastGap'
  }
}

interface RawEvent {
  kind?: unknown
  schemaVersion?: unknown
  payload?: unknown
}

// Chains: v1→v2 then v2→v3, so an upcaster only ever knows about the single step it was written
// for. A row already at the current version is returned untouched, byte for byte.
export function upcastEvent(
  raw: unknown,
  registry: UpcastRegistry = UPCASTERS,
  target: number = EVENT_SCHEMA_VERSION,
): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const event = raw as RawEvent
  const kind = event.kind
  const written = event.schemaVersion

  if (typeof kind !== 'string' || typeof written !== 'number') return raw
  if (written >= target) return raw

  let version = written

  let payload = event.payload
  while (version < target) {
    const step = registry.find((one) => one.kind === kind && one.from === version)
    if (step === undefined) throw new UpcastGap(kind, version, target)
    payload = step.upcast(payload)
    version = step.to
  }

  return { ...event, schemaVersion: version, payload }
}

// The single read boundary: upcast first, validate after. Validating first would reject every old
// row on the way in and make the upcaster unreachable.
export function readEvent(
  raw: unknown,
  context: string,
  registry: UpcastRegistry = UPCASTERS,
): AnyEvent {
  const upcast = upcastEvent(raw, registry)
  assertValidEvent(upcast, context)
  return upcast
}
