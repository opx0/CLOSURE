import { Type, type Static } from '@sinclair/typebox'
import {
  CLAIM_STATUS_RUBRIC_ID,
  ClaimAbstentionSchema,
  ClaimVerdictSchema,
  ComposureSignalSchema,
  LevelSchema,
  isPressureAction,
  type Claim,
  type Evidence,
  type EvidenceSubject,
  type Finding,
  type InvocationRecord,
  type Level,
  type PolicyAction,
  type RoundKind,
  type RoleId,
  type RubricSet,
  type Span,
  type Competency,
} from '@closer/contracts'
import { answerEvaluationPrompt, type AnswerEvaluationVars } from '@closer/prompts'
import type { ArtifactContext } from '../ports/conductor.ts'
import type { Clock, IdSource } from '../ports/clock.ts'
import type { EvaluatorPort, StructuredFailure } from '../ports/evaluator.ts'
import { locateQuote, type QuoteLocation } from '../events/sources.ts'
import { expectedConceptsFor } from '../roles/packs.ts'
import { anchorFor, rubricFor } from './rubrics.ts'

const judgment = {
  rationale: Type.String({ minLength: 1 }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  // The model supplies the words, code supplies the offsets — a model-produced byte offset would be
  // an opinion formatted as an integer (ticket 05 §2).
  quotes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}

// `composure` is missing on purpose: it arrives as its own kind, only on a pressure turn. Offering
// it as a competency verdict would be the one fold §4.3 forbids.
const JudgedCompetencySchema = Type.Union([
  Type.Literal('mechanism'),
  Type.Literal('trade_offs'),
  Type.Literal('failure_modes'),
])

// `additionalProperties: false` throughout: refusing a response with an extra field defends against
// an unasked-for verdict by contract, not by accident of only reading named fields.
const closed = { additionalProperties: false } as const

export const EvaluationOutputSchema = Type.Object(
  {
    findings: Type.Array(
      Type.Union([
        Type.Object(
          { ...judgment, kind: Type.Literal('claim'), verdict: ClaimVerdictSchema },
          closed,
        ),
        Type.Object(
          {
            ...judgment,
            kind: Type.Literal('claim_abstained'),
            abstention: ClaimAbstentionSchema,
          },
          closed,
        ),
        Type.Object(
          {
            ...judgment,
            kind: Type.Literal('composure'),
            signals: Type.Array(ComposureSignalSchema, { minItems: 1 }),
          },
          closed,
        ),
        Type.Object(
          {
            ...judgment,
            kind: Type.Literal('competency'),
            competency: JudgedCompetencySchema,
            levelMet: Type.Union([LevelSchema, Type.Null()]),
          },
          closed,
        ),
      ]),
    ),
  },
  closed,
)
export type EvaluationOutput = Static<typeof EvaluationOutputSchema>
type Judgment = EvaluationOutput['findings'][number]

// Sized to hold every finding a turn can produce — a truncation is a named `max_tokens` failure,
// never a silently partial evaluation.
const MAX_OUTPUT_TOKENS = 4096

export interface EvaluateAnswerInput {
  attemptId: string
  claim: Claim | null
  claimSpanId?: string
  action: PolicyAction
  // A round changes what is being tested, so it changes what the anchors mean (§4.7).
  round: RoundKind
  // Present only on a walkthrough (§4.8); where an answer contradicts the code shown, the code wins.
  artifact?: ArtifactContext
  level: Level
  answerText: string
  answerSourceId: string
  // Taken from the prompt's own vars so the Evaluator's shape can't drift from what the model saw.
  transcript: AnswerEvaluationVars['transcript']
  rubricSet: RubricSet
  // A role pack adds what that role expects to the anchor's required concepts. It is data handed to
  // the same prompt, never a second prompt — the template and its hash are untouched by it.
  role?: RoleId
  evaluator: EvaluatorPort
  ids: IdSource
  clock: Clock
}

export interface DroppedFinding {
  rationale: string
  reason: string
}

export type EvaluationResult =
  | {
      findings: Finding[]
      evidence: Evidence[]
      spans: Span[]
      invocation: InvocationRecord
      dropped: DroppedFinding[]
    }
  | { failed: StructuredFailure; invocation: InvocationRecord }

function nonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] | null {
  const [head, ...tail] = items
  return head === undefined ? null : [head, ...tail]
}

function anchorsForTurn(input: EvaluateAnswerInput): AnswerEvaluationVars['anchors'] {
  return input.rubricSet.flatMap((ref) => {
    if (ref.id === CLAIM_STATUS_RUBRIC_ID && input.claim === null) return []
    if (ref.id === 'composure' && !isPressureAction(input.action)) return []

    const rubric = rubricFor(ref)
    const anchor = rubric === undefined ? undefined : anchorFor(rubric, input.level)
    if (anchor === undefined) return []

    const roleConcepts =
      input.role === undefined ? [] : expectedConceptsFor(input.role, ref.id as Competency)

    return [
      {
        rubricId: ref.id,
        rubricVersion: ref.version,
        expectation: anchor.expectation,
        requiredConcepts: [...anchor.requiredConcepts, ...roleConcepts],
      },
    ]
  })
}

function rubricIdFor(judged: Judgment): string {
  switch (judged.kind) {
    case 'claim':
    case 'claim_abstained':
      return CLAIM_STATUS_RUBRIC_ID
    case 'composure':
      return 'composure'
    case 'competency':
      return judged.competency
  }
}

export async function evaluateAnswer(input: EvaluateAnswerInput): Promise<EvaluationResult> {
  const claim = input.claim
  const rendered = answerEvaluationPrompt.render({
    level: input.level,
    action: input.action,
    round: input.round,
    claim: claim === null ? null : { type: claim.type, assertion: claim.assertion },
    anchors: anchorsForTurn(input),
    // Conductor and Evaluator are handed the same lines, or a walkthrough is judged against code
    // the candidate was never shown.
    ...(input.artifact === undefined
      ? {}
      : {
          artifact: {
            path: input.artifact.path,
            symbol: input.artifact.symbol,
            startLine: input.artifact.startLine,
            endLine: input.artifact.endLine,
            code: input.artifact.code,
          },
        }),
    transcript: input.transcript,
    answerText: input.answerText,
  })

  const result = await input.evaluator.complete({
    promptId: answerEvaluationPrompt.id,
    promptVersion: answerEvaluationPrompt.version,
    promptHash: answerEvaluationPrompt.hash,
    system: rendered.system,
    user: rendered.user,
    schema: EvaluationOutputSchema,
    schemaName: 'answer_evaluation',
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  // A failed call is a failure, never an evaluation that happened to find nothing.
  if (!result.ok) return { failed: result.failure, invocation: result.invocation }

  const findings: Finding[] = []
  const evidence: Evidence[] = []
  const spans: Span[] = []
  const dropped: DroppedFinding[] = []

  const spansByRange = new Map<string, Span>()
  const spanFor = (quote: string, at: QuoteLocation): Span => {
    const range = `${at.startByte}:${at.endByte}`
    const known = spansByRange.get(range)
    if (known !== undefined) return known

    const span: Span = {
      id: input.ids.next('span'),
      sourceId: input.answerSourceId,
      startByte: at.startByte,
      endByte: at.endByte,
      quoted: quote,
    }
    spansByRange.set(range, span)
    spans.push(span)
    return span
  }

  const evidenceFor = (
    subject: EvidenceSubject,
    spanId: string,
    trust: Evidence['trust'],
  ): string => {
    const record: Evidence = {
      id: input.ids.next('evidence'),
      subject,
      target: { kind: 'span', spanId },
      trust,
    }
    evidence.push(record)
    return record.id
  }

  for (const judged of result.value.findings) {
    const drop = (reason: string): void => {
      dropped.push({ rationale: judged.rationale, reason })
    }

    if (judged.kind === 'composure' && !isPressureAction(input.action)) {
      drop('composure_without_pressure_action')
      continue
    }
    if ((judged.kind === 'claim' || judged.kind === 'claim_abstained') && claim === null) {
      drop('claim_finding_without_claim')
      continue
    }

    const rubricId = rubricIdFor(judged)
    const rubric = input.rubricSet.find((ref) => ref.id === rubricId)
    if (rubric === undefined) {
      // A finding judged against a rubric the session didn't pin is unattributable a week later.
      drop(`rubric_not_pinned: ${rubricId}`)
      continue
    }

    const located: { quote: string; at: QuoteLocation }[] = []
    let unresolvable: string | null = null
    for (const quote of judged.quotes) {
      const at = locateQuote(input.answerText, quote)
      if (at === null) {
        unresolvable = quote
        break
      }
      // A phrase said twice still resolves — the invariant is matching source bytes, not uniqueness.
      located.push({ quote, at })
    }
    if (unresolvable !== null) {
      // Never repaired to the nearest match — an unresolved citation is unverifiable (ticket 05 §3).
      drop(`unresolvable_quote: ${JSON.stringify(unresolvable)}`)
      continue
    }

    const spanIds = nonEmpty([...new Set(located.map((hit) => spanFor(hit.quote, hit.at).id))])
    if (spanIds === null) {
      drop('empty_quote_list')
      continue
    }

    // A union, not a claim id with a convention layered on top: a competency/composure finding is
    // about the answer, not a claim.
    const subject: EvidenceSubject = claim
      ? { kind: 'claim', claimId: claim.id }
      : { kind: 'attempt', attemptId: input.attemptId }
    const [firstSpanId, ...restSpanIds] = spanIds
    const evidenceIds: [string, ...string[]] = [
      evidenceFor(subject, firstSpanId, 'transcript_observed'),
    ]
    for (const spanId of restSpanIds) {
      evidenceIds.push(evidenceFor(subject, spanId, 'transcript_observed'))
    }
    // Only a claim finding gets the résumé link — irrelevant to a judgment about how they answered.
    const aboutTheClaim = judged.kind === 'claim' || judged.kind === 'claim_abstained'
    if (aboutTheClaim && claim !== null && input.claimSpanId !== undefined) {
      evidenceIds.push(
        evidenceFor({ kind: 'claim', claimId: claim.id }, input.claimSpanId, 'candidate_asserted'),
      )
    }

    const base = {
      id: input.ids.next('finding'),
      attemptId: input.attemptId,
      rubric,
      level: input.level,
      rationale: judged.rationale,
      confidence: judged.confidence,
      modelVersion: result.invocation.modelAlias,
      promptVersion: String(answerEvaluationPrompt.version),
      transcriptSpanIds: spanIds,
      evidenceIds,
    }

    switch (judged.kind) {
      case 'claim':
      case 'claim_abstained': {
        // Re-checked: the narrowing above doesn't survive the work in between, and a fabricated
        // claim id is worse than a dropped finding.
        if (claim === null) {
          drop('claim_finding_without_claim')
          continue
        }
        findings.push(
          judged.kind === 'claim'
            ? { ...base, kind: 'claim', claimId: claim.id, verdict: judged.verdict }
            : // An abstention travels this same path and cites what it read (§4.4).
              {
                ...base,
                kind: 'claim_abstained',
                claimId: claim.id,
                abstention: judged.abstention,
              },
        )
        break
      }
      case 'composure':
        findings.push({
          ...base,
          kind: 'composure',
          competency: 'composure',
          signals: judged.signals,
        })
        break
      case 'competency':
        findings.push({
          ...base,
          kind: 'competency',
          competency: judged.competency,
          levelMet: judged.levelMet,
        })
        break
    }
  }

  return { findings, evidence, spans, invocation: result.invocation, dropped }
}
