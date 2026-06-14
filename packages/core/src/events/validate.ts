import { type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  AnswerReceivedSchema,
  EvaluationProducedSchema,
  EventSchema,
  ObservationRecordedSchema,
  PlanRecordedSchema,
  PolicyActionSelectedSchema,
  QuestionRenderedSchema,
  StateChangeSchema,
  type AnyEvent,
  type EventKind,
} from '@closer/contracts'

// TypeBox reports a failed union as a bare error at the root; re-running against the `kind`-selected
// branch gives a real path.
const schemaOfKind: Record<EventKind, TSchema> = {
  plan: PlanRecordedSchema,
  policy_action: PolicyActionSelectedSchema,
  question: QuestionRenderedSchema,
  answer: AnswerReceivedSchema,
  observation: ObservationRecordedSchema,
  evaluation: EvaluationProducedSchema,
  state_change: StateChangeSchema,
}

function isKind(value: unknown): value is EventKind {
  return typeof value === 'string' && value in schemaOfKind
}

function faultOf(value: unknown): string {
  if (typeof value !== 'object' || value === null)
    return `expected an event object, got ${typeof value}`
  const kind: unknown = (value as { kind?: unknown }).kind
  if (!isKind(kind)) return `unknown event kind ${JSON.stringify(kind)}`
  const [first] = [...Value.Errors(schemaOfKind[kind], value)]
  if (first === undefined) return `does not match the ${kind} schema`
  return `${first.path === '' ? '/' : first.path}: ${first.message}`
}

// Unfixable once logged — append-only — so this throws at the write boundary, never just warns.
export function assertValidEvent(value: unknown, context: string): asserts value is AnyEvent {
  if (Value.Check(EventSchema, value)) return
  throw new Error(`${context} is not a valid event — ${faultOf(value)}`)
}
