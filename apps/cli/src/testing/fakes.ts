import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AnyEvent, InvocationRecord } from '@levelhead/contracts'
import { AppendOnlyViolation } from '@levelhead/core'
import type {
  Clock,
  ConductorPort,
  EventStore,
  EvaluatorPort,
  IdSource,
  RenderQuestionInput,
  RenderedQuestion,
  StructuredRequest,
  StructuredResult,
} from '@levelhead/core'

// Not a convenience — replay identity is only testable if time and ids are injected.
export class FixedClock implements Clock {
  #tick = 0
  constructor(private readonly start = Date.parse('2026-09-09T09:00:00.000Z')) {}
  now(): string {
    return new Date(this.start + this.#tick++ * 1000).toISOString()
  }
}

export class SeqIds implements IdSource {
  #counters = new Map<string, number>()
  next(prefix: string): string {
    const next = (this.#counters.get(prefix) ?? 0) + 1
    this.#counters.set(prefix, next)
    return `${prefix}_${String(next).padStart(4, '0')}`
  }
}

export class MemoryEventStore implements EventStore {
  readonly sessions = new Map<string, AnyEvent[]>()

  async append(event: AnyEvent): Promise<void> {
    const existing = this.sessions.get(event.sessionId) ?? []
    if (existing.some((other) => other.seq === event.seq)) {
      throw new AppendOnlyViolation(event.sessionId, event.seq)
    }
    this.sessions.set(event.sessionId, [...existing, event])
  }

  async read(sessionId: string): Promise<AnyEvent[]> {
    return [...(this.sessions.get(sessionId) ?? [])]
  }

  async listSessions(): Promise<string[]> {
    return [...this.sessions.keys()]
  }
}

export function fakeInvocation(overrides: Partial<InvocationRecord> = {}): InvocationRecord {
  return {
    id: 'inv_0001',
    port: 'evaluator',
    modelAlias: 'fake',
    promptId: 'fake',
    promptVersion: 1,
    promptHash: 'deadbeef',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    stopReason: 'end_turn',
    latencyMs: 0,
    occurredAt: '2026-09-09T09:00:00.000Z',
    ...overrides,
  }
}

// Scripted rather than generative — a test asserting what was asked has to control what was said.
export class ScriptedConductor implements ConductorPort {
  readonly calls: RenderQuestionInput[] = []
  constructor(private readonly questions: readonly string[]) {}

  async renderQuestion(input: RenderQuestionInput): Promise<RenderedQuestion> {
    this.calls.push(input)
    const text = this.questions[this.calls.length - 1] ?? 'And?'
    return { text, invocation: fakeInvocation({ port: 'conductor', promptId: 'question-render' }) }
  }
}

export class ScriptedEvaluator implements EvaluatorPort {
  readonly prompts: { promptId: string; user: string }[] = []
  #queue: unknown[]

  constructor(values: readonly unknown[]) {
    this.#queue = [...values]
  }

  async complete<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<Static<T>>> {
    this.prompts.push({ promptId: request.promptId, user: request.user })
    const value = this.#queue.shift()
    if (value === undefined) {
      return {
        ok: false,
        failure: { kind: 'transport', message: 'script exhausted' },
        invocation: fakeInvocation(),
      }
    }
    // Keeps the fakes honest — a test can't pass by feeding a shape the real model could never return.
    if (!Value.Check(request.schema, value)) {
      const errors = [...Value.Errors(request.schema, value)].map((e) => `${e.path}: ${e.message}`)
      return {
        ok: false,
        failure: { kind: 'schema_mismatch', errors, raw: JSON.stringify(value) },
        invocation: fakeInvocation(),
      }
    }
    return { ok: true, value: value as Static<T>, invocation: fakeInvocation() }
  }
}
