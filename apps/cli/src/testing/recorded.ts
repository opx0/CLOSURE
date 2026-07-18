import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AnyEvent, Finding, InvocationRecord, Span } from '@closer/contracts'
import type {
  ConductorPort,
  EvaluatorPort,
  RenderedQuestion,
  StructuredRequest,
  StructuredResult,
} from '@closer/core'

// Ports that answer strictly from an event log — no fresh generation, no fallback; an exhausted log
// throws rather than quietly inventing a turn.

export interface RecordedQuestion {
  text: string
  invocation: InvocationRecord
}

export function recordedQuestions(events: readonly AnyEvent[]): RecordedQuestion[] {
  return events.flatMap((event) =>
    event.kind === 'question'
      ? [{ text: event.payload.text, invocation: event.payload.invocation }]
      : [],
  )
}

export function recordedAnswers(events: readonly AnyEvent[]): string[] {
  return events.flatMap((event) => (event.kind === 'answer' ? [event.payload.text] : []))
}

// The inverse of `evaluateAnswer`'s forward pass — reconstructs only the model's half of the
// contract (kind, judgment, confidence, quotes); everything code-supplied is left out. Lossy for a
// dropped finding, which never reached an `evaluation` event, so replay-identity uses a log with none.
function judgmentFrom(finding: Finding, spans: ReadonlyMap<string, Span>): unknown {
  const quotes = finding.transcriptSpanIds.map((id) => {
    const span = spans.get(id)
    if (span === undefined) throw new Error(`recorded: ${finding.id} cites unknown span ${id}`)
    return span.quoted
  })
  const judgment = { rationale: finding.rationale, confidence: finding.confidence, quotes }

  switch (finding.kind) {
    case 'claim':
      return { ...judgment, kind: 'claim', verdict: finding.verdict }
    case 'claim_abstained':
      return { ...judgment, kind: 'claim_abstained', abstention: finding.abstention }
    case 'composure':
      return { ...judgment, kind: 'composure', signals: finding.signals }
    case 'competency':
      return {
        ...judgment,
        kind: 'competency',
        competency: finding.competency,
        levelMet: finding.levelMet,
      }
  }
}

export interface RecordedEvaluation {
  output: unknown
  invocation: InvocationRecord
}

export function recordedEvaluations(events: readonly AnyEvent[]): RecordedEvaluation[] {
  return events.flatMap((event) => {
    if (event.kind !== 'evaluation') return []
    const spans = new Map(event.payload.spans.map((span) => [span.id, span]))
    const findings = event.payload.findings as unknown as readonly Finding[]
    return [
      {
        output: { findings: findings.map((finding) => judgmentFrom(finding, spans)) },
        invocation: event.payload.invocation,
      },
    ]
  })
}

export class RecordedConductor implements ConductorPort {
  #queue: RecordedQuestion[]

  constructor(events: readonly AnyEvent[]) {
    this.#queue = recordedQuestions(events)
  }

  // `input` is ignored on purpose — reading it would be the door a fresh generation walks in through.
  async renderQuestion(): Promise<RenderedQuestion> {
    const next = this.#queue.shift()
    if (next === undefined) throw new Error('recorded: the log has no further question to replay')
    return { text: next.text, invocation: next.invocation }
  }
}

export class RecordedEvaluator implements EvaluatorPort {
  #queue: RecordedEvaluation[]

  constructor(events: readonly AnyEvent[]) {
    this.#queue = recordedEvaluations(events)
  }

  async complete<T extends TSchema>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResult<Static<T>>> {
    const next = this.#queue.shift()
    if (next === undefined) throw new Error('recorded: the log has no further evaluation to replay')

    // Validated exactly as a live response is — a mismatch means the log and contract drifted apart.
    if (!Value.Check(request.schema, next.output)) {
      const errors = [...Value.Errors(request.schema, next.output)].map(
        (error) => `${error.path || '/'}: ${error.message}`,
      )
      return {
        ok: false,
        failure: { kind: 'schema_mismatch', errors, raw: JSON.stringify(next.output) },
        invocation: next.invocation,
      }
    }
    return { ok: true, value: next.output as Static<T>, invocation: next.invocation }
  }
}
