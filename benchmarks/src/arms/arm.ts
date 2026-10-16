import { Buffer } from 'node:buffer'
import {
  CeilingBreach,
  CeilingLedger,
  locateQuote,
  resolveSpan,
  type Ceilings,
  type Clock,
  type ConductorPort,
  type EvaluatorPort,
  type IdSource,
} from '@levelhead/core'
import type {
  Claim,
  Evidence,
  Finding,
  GapEntry,
  InvocationRecord,
  Level,
  Mode,
  PersonaId,
  PolicyAction,
  RubricSet,
  Span,
} from '@levelhead/contracts'
import type {
  ArmId,
  EvidenceLinkOutcome,
  ExtractionOutcome,
  FindingOutcome,
  FixtureItem,
  FixtureResume,
  GapOutcome,
  ItemOutcome,
  TranscriptTurn,
} from '../contract.ts'

// The Conductor adapters the model-layer arms need. Absent means the arm publishes a failure for
// every item rather than quietly running the default adapter and reporting it as a local-model
// result (ticket 16).
export interface AlternateConductors {
  levelhead_local_model?: ConductorPort
  levelhead_headless_agent?: ConductorPort
}

// Identical for every arm — budget equivalence (ticket 16) is then measured via each outcome's own
// token/cost actuals, not assumed from identical setup.
export interface ArmContext {
  conductor: ConductorPort
  alternateConductors?: AlternateConductors
  evaluator: EvaluatorPort
  clock: Clock
  ids: IdSource
  level: Level
  mode: Mode
  personaId: PersonaId
  rubricSet: RubricSet
  ceilings: Ceilings
  maxTurns: number
}

// The runner never branches on which arm it holds — an arm needing special handling wouldn't be a
// fair comparison.
export interface Arm {
  id: ArmId
  description: string
  // Names the alternate Conductor this arm must run behind. The runner refuses to substitute the
  // default one: an arm that silently fell back would publish the wrong model's numbers.
  requiresConductor?: keyof AlternateConductors
  // Null when the arm has no extraction step — scoring it as F1 = 0 would say something different
  // (and false).
  extract: ((resume: FixtureResume, ctx: ArmContext) => Promise<ExtractionOutcome>) | null
  // resume travels with item because a claim's span points into it — an arm without it can't
  // resolve its own citations.
  interrogate(item: FixtureItem, resume: FixtureResume, ctx: ArmContext): Promise<ItemOutcome>
}

export function claimFromFixture(
  item: FixtureItem,
  resume: FixtureResume,
  ids: IdSource,
): { claim: Claim; span: Span } | null {
  const at = locateQuote(resume.text, item.claim.quote)
  // A fixture whose claim quote is not in its own resume is a broken fixture — inventing the span
  // here would hide it behind a run that looked fine.
  if (at === null) return null

  const span: Span = {
    id: ids.next('span'),
    sourceId: resume.id,
    startByte: at.startByte,
    endByte: at.endByte,
    quoted: item.claim.quote,
  }
  return {
    span,
    claim: {
      id: ids.next('claim'),
      spanId: span.id,
      type: item.claim.type,
      assertion: item.claim.assertion,
      technologies: [...item.claim.technologies],
      metrics: [...item.claim.metrics],
      implied: false,
      // PROJECT.md 4.1's confirmation step has its own test and is not what any arm is compared on.
      confirmedByCandidate: true,
      extractorVersion: 'fixture',
    },
  }
}

export function findingOutcome(finding: Finding, spans: ReadonlyMap<string, Span>): FindingOutcome {
  return {
    findingId: finding.id,
    kind: finding.kind,
    competency:
      finding.kind === 'claim' || finding.kind === 'claim_abstained' ? null : finding.competency,
    verdict: finding.kind === 'claim' ? finding.verdict : null,
    abstention:
      finding.kind === 'claim_abstained' || finding.kind === 'competency_abstained'
        ? finding.abstention
        : null,
    confidence: finding.confidence,
    rationale: finding.rationale,
    quotes: finding.transcriptSpanIds.map((id) => spans.get(id)?.quoted ?? ''),
  }
}

// Centralises what a run publishes so an arm can't quietly omit its transcript, invocations, or
// failed turns.
export class ItemRecorder {
  readonly #transcript: TranscriptTurn[] = []
  readonly #actions: PolicyAction[] = []
  readonly #findings: FindingOutcome[] = []
  readonly #gaps: GapOutcome[] = []
  readonly #links: EvidenceLinkOutcome[] = []
  readonly #invocations: InvocationRecord[] = []
  readonly #sources = new Map<string, string>()
  readonly #ledger: CeilingLedger
  #questionsAsked = 0
  #claimJudgments = 0
  #abstentions = 0
  #insufficientTurns = 0
  #abstentionsOnInsufficient = 0
  #failure: string | null = null

  constructor(
    private readonly itemId: string,
    private readonly armId: ArmId,
    ceilings: Ceilings,
    private readonly injection: FixtureItem['injection'],
  ) {
    this.#ledger = new CeilingLedger(ceilings)
  }

  source(id: string, text: string): void {
    this.#sources.set(id, text)
  }

  beginTurn(): void {
    this.#ledger.beginTurn()
  }

  // Before the call, never after: ticket 10 puts the ceiling check in front of the provider — a
  // ceiling checked afterwards has already been breached.
  assertCanCall(): void {
    this.#ledger.assertCanCall()
  }

  record(invocation: InvocationRecord): void {
    this.#ledger.record(invocation)
    this.#invocations.push(invocation)
  }

  question(action: PolicyAction, text: string): void {
    this.#actions.push(action)
    this.#questionsAsked += 1
    this.#transcript.push({ role: 'interviewer', text })
  }

  answer(text: string, insufficientEvidence: boolean): void {
    this.#transcript.push({ role: 'candidate', text })
    if (insufficientEvidence) this.#insufficientTurns += 1
  }

  // Takes the published shape rather than a `Finding`, because the baselines never build one — an
  // arm with no citation discipline has a judgment and some quotes, which is exactly what the report
  // should show it having.
  finding(finding: FindingOutcome, insufficientEvidence: boolean): void {
    this.#findings.push(finding)
    if (finding.kind === 'claim' || finding.kind === 'claim_abstained') this.#claimJudgments += 1
    if (finding.kind === 'claim_abstained') {
      this.#abstentions += 1
      if (insufficientEvidence) this.#abstentionsOnInsufficient += 1
    }
  }

  gaps(opened: readonly GapEntry[]): void {
    for (const gap of opened) {
      this.#gaps.push({
        gapId: gap.id,
        competency: gap.competency,
        status: gap.status,
        summary: gap.summary,
      })
    }
  }

  // `resolves` is checked here rather than trusted from the arm: it is ticket 05 §3's span-validity
  // invariant, and an arm that skipped the check would report perfect provenance for free.
  evidence(links: readonly Evidence[], spans: ReadonlyMap<string, Span>): void {
    for (const link of links) {
      if (link.target.kind !== 'span') continue
      const span = spans.get(link.target.spanId)
      if (span === undefined) {
        this.#links.push({
          evidenceId: link.id,
          subject: link.subject.kind,
          sourceId: '(missing)',
          quoted: '',
          startByte: 0,
          endByte: 0,
          resolves: false,
          supportsSubject: null,
        })
        continue
      }
      this.#links.push({
        evidenceId: link.id,
        subject: link.subject.kind,
        sourceId: span.sourceId,
        quoted: span.quoted,
        startByte: span.startByte,
        endByte: span.endByte,
        resolves: resolveSpan(span, this.#sources).ok,
        // Filled in later from the label index, never by the arm — an arm grading its own citations
        // is the exact failure this metric exists to catch.
        supportsSubject: null,
      })
    }
  }

  // A citation an arm emitted without resolving it first. The baselines take model quotes at face
  // value, so the offsets are recovered here, after the fact, against every source the arm read.
  looseCitation(evidenceId: string, quoted: string): void {
    for (const [sourceId, text] of this.#sources) {
      const at = locateQuote(text, quoted)
      if (at === null) continue
      this.#links.push({
        evidenceId,
        subject: 'claim',
        sourceId,
        quoted,
        startByte: at.startByte,
        endByte: at.endByte,
        resolves: true,
        supportsSubject: null,
      })
      return
    }
    this.#links.push({
      evidenceId,
      subject: 'claim',
      sourceId: '(unresolved)',
      quoted,
      startByte: 0,
      endByte: Buffer.byteLength(quoted, 'utf8'),
      resolves: false,
      supportsSubject: null,
    })
  }

  fail(reason: string): void {
    this.#failure = reason
  }

  // A breach is a named failure that ends the item, exactly as it ends a session — published like
  // any other outcome rather than retried into a number.
  breach(error: unknown): void {
    this.#failure =
      error instanceof CeilingBreach ? `ceiling_breach: ${error.message}` : String(error)
  }

  finish(): ItemOutcome {
    const canary = this.injection?.canary ?? null
    const emitted = [
      ...this.#transcript.filter((turn) => turn.role === 'interviewer').map((turn) => turn.text),
      ...this.#findings.map((finding) => finding.rationale),
    ]

    return {
      itemId: this.itemId,
      armId: this.armId,
      transcript: this.#transcript,
      actions: this.#actions,
      questionsAsked: this.#questionsAsked,
      findings: this.#findings,
      gaps: this.#gaps,
      evidenceLinks: this.#links,
      claimJudgments: this.#claimJudgments,
      abstentions: this.#abstentions,
      insufficientEvidenceTurns: this.#insufficientTurns,
      abstentionsOnInsufficientEvidence: this.#abstentionsOnInsufficient,
      injection:
        canary === null
          ? null
          : {
              canary,
              // Deterministic (ticket 05 §2): a substring search, not a model judging its own output.
              succeeded: emitted.some((text) => text.includes(canary)),
            },
      invocations: this.#invocations,
      failure: this.#failure,
    }
  }
}
