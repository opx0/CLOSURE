import {
  COMPOSURE_HELD,
  widenFindings,
  type ClaimAbstention,
  type ClaimVerdict,
  type CompetenceLane,
  type Competency,
  type ComposureSignal,
  type ImprovementPlan,
  type GapEntry,
  type Claim,
  LEVEL_ORDER,
} from '@levelhead/contracts'
import type { SessionView } from '../events/replay.ts'
import { renderLedger } from '../gaps/ledger.ts'
import { topicById, nextTransferVariant } from '../topics/index.ts'
import { spanViolations } from '../events/sources.ts'

// One of the debrief's two halves. This file may name findings, gaps, rubrics and competencies and
// may not name a single measured signal; `performance.ts` has the mirrored restriction, and the
// invariant test greps both. Neither file can see enough to average them.

export function competenceLane(view: SessionView): CompetenceLane {
  // Every attempt records the level it was asked at, so a session that stepped back down still
  // reports the level it actually reached rather than the level it happened to end on.
  const pressureReached = [
    view.session?.pressureLevel ?? 0,
    view.pressureLevel,
    ...[...view.attempts.values()].map((attempt) => attempt.pressureLevel),
  ].reduce((highest, level) => Math.max(highest, level), 0)

  return {
    plan: improvementPlan(view),
    // The contract carries the schema's own array type; `widenFindings` is the helper it exports for
    // dropping the compile-time non-empty tuples that mean the same thing as its `minItems: 1`.
    findings: widenFindings(view.findings),
    // `view.gaps` holds only rows an event in this session opened or moved, which is exactly
    // "touched this session".
    gaps: [...view.gaps.values()],
    abstentions: view.findings.filter(
      (finding) => finding.kind === 'claim_abstained' || finding.kind === 'competency_abstained',
    ).length,
    pressureReached,
  }
}

export function improvementPlan(
  view: SessionView,
  context: {
    gaps?: ReadonlyMap<string, GapEntry>
    exposedVariants?: ReadonlySet<string>
    confirmedClaims?: ReadonlyMap<string, Claim>
  } = {},
): ImprovementPlan {
  const summary = (
    findings: readonly import('@levelhead/contracts').Finding[],
    reason?: string,
  ) => ({
    findingIds: findings.map((finding) => finding.id),
    summary: reason ?? findings.map((finding) => finding.rationale).join(' '),
    quotes: [...new Set(findings.flatMap((finding) => [...finding.transcriptSpanIds]))].flatMap(
      (id) => {
        const span = view.spans.get(id)
        return span !== undefined && spanViolations([span], view.sources).length === 0 ? [span] : []
      },
    ),
  })
  const uncertainty: ImprovementPlan['uncertainty'] = []
  const strengths: ImprovementPlan['strengths'] = []
  for (const finding of view.findings) {
    const cited = summary([finding])
    if (finding.kind === 'claim_abstained' || finding.kind === 'competency_abstained')
      uncertainty.push(cited)
    else if (cited.quotes.length === 0)
      uncertainty.push(
        summary(
          [finding],
          'The answer citation is unavailable; no priority or strength is inferred.',
        ),
      )
    else if (
      (finding.kind === 'claim' && finding.verdict === 'supported') ||
      (finding.kind === 'competency' &&
        finding.levelMet !== null &&
        LEVEL_ORDER.indexOf(finding.levelMet) >= LEVEL_ORDER.indexOf(finding.level))
    )
      strengths.push(cited)
    const review = view.findingReviews?.filter((review) => review.findingId === finding.id).at(-1)
    if (review?.state === 'pending')
      uncertainty.push(
        summary(
          [finding],
          'Candidate disagreement is pending review; the finding has not been retracted.',
        ),
      )
  }
  const historical = view.historicalFindings ?? view.findings
  for (const [id] of view.supersededFindings ?? []) {
    const finding = historical.find((finding) => finding.id === id)
    if (finding !== undefined)
      uncertainty.push(
        summary(
          [finding],
          'Previous feedback was superseded. The corrected evidence has not been reassessed.',
        ),
      )
  }
  const priorities: ImprovementPlan['leading'] = []
  for (const gap of [...(context.gaps ?? view.gaps).values()].sort(
    (a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id),
  )) {
    if (gap.status !== 'open' && gap.status !== 'drilled') continue
    const findings = view.findings.filter(
      (finding) =>
        gap.findingIds.includes(finding.id) &&
        finding.kind !== 'claim_abstained' &&
        finding.kind !== 'competency_abstained' &&
        finding.kind !== 'composure',
    )
    if (findings.length === 0) continue
    const evidence = summary(findings)
    if (evidence.quotes.length === 0) continue
    const topic = gap.topicId === undefined ? undefined : topicById(gap.topicId)
    const concepts = gap.competency === 'composure' ? undefined : topic?.expected[gap.competency]
    const claim = gap.claimId === undefined ? undefined : context.confirmedClaims?.get(gap.claimId)
    const guidance =
      claim === undefined
        ? undefined
        : {
            mechanism:
              'Describe the sequence of actions, what you personally did, and evidence for the result.',
            trade_offs: 'Explain the alternatives, the reason for your choice, and what it cost.',
            failure_modes:
              'Explain a concrete failure, how you would detect it, and what limits remain.',
            composure: 'Distinguish what you know from what you cannot establish.',
          }[gap.competency]
    priorities.push({
      ...evidence,
      gapId: gap.id,
      nextAction:
        gap.status === 'open' &&
        (topic !== undefined ||
          (gap.claimId !== undefined &&
            (context.confirmedClaims === undefined || claim !== undefined)))
          ? 'drill'
          : gap.status === 'drilled' &&
              gap.topicId !== undefined &&
              nextTransferVariant(gap.topicId, context.exposedVariants ?? new Set()) !== undefined
            ? 'transfer'
            : 'unavailable',
      ...(gap.topicId === undefined ? {} : { topicId: gap.topicId }),
      ...(gap.claimId === undefined ? {} : { claimId: gap.claimId }),
      ...(concepts === undefined
        ? guidance === undefined || claim === undefined
          ? {}
          : {
              explanation: `${guidance} This is general guidance, not verification of the claim.`,
              exercise: `For your confirmed claim “${claim.assertion}”, revisit the cited answer and address the missing reasoning in your own words.`,
            }
        : {
            explanation: concepts.join('; '),
            exercise: `Apply the reasoning to this scenario: ${topic!.twist}. Explain the mechanism and trade-offs in your own words.`,
          }),
      retest: 'separate_unfamiliar_variant_required',
    })
  }
  return { leading: priorities.slice(0, 3), remaining: priorities.slice(3), strengths, uncertainty }
}

// A finding cites span ids and a ledger row cites evidence ids. Both resolve to the same quoted text
// from the same view, so the renderers below take one lookup rather than two.
export function quotesFrom(view: SessionView): Map<string, string> {
  const quotes = new Map<string, string>()
  for (const span of view.spans.values()) quotes.set(span.id, span.quoted)
  for (const link of view.evidence.values()) {
    if (link.target.kind !== 'span') continue
    const span = view.spans.get(link.target.spanId)
    if (span !== undefined) quotes.set(link.id, span.quoted)
  }
  return quotes
}

// The lane holds findings in the contract's own schema type, so the renderers below speak that
// rather than the tuple-strengthened `Finding`.
type LaneFinding = CompetenceLane['findings'][number]

const SUBJECT_LABEL: Record<Competency, string> = {
  mechanism: 'Mechanism',
  trade_offs: 'Trade-offs',
  failure_modes: 'Failure modes',
  composure: 'Composure',
}

const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  supported: 'supported',
  partially_supported: 'partially supported',
  unsupported_by_available_evidence: 'unsupported by available evidence',
  contradicted: 'contradicted',
}

const ABSTENTION_LABEL: Record<ClaimAbstention, string> = {
  insufficient_evidence: 'insufficient evidence',
  not_verifiable: 'not verifiable',
}

const COMPOSURE_LABEL: Record<ComposureSignal, string> = {
  folding: 'folding',
  fabricating: 'fabricating',
  holding_ground: 'holding ground',
  honest_yielding: 'honest yielding',
  coherence_after_interruption: 'coherence after an interruption',
  escalation: 'escalation',
}

function verdictOf(finding: LaneFinding): string {
  switch (finding.kind) {
    case 'claim':
      return VERDICT_LABEL[finding.verdict]
    case 'claim_abstained':
    case 'competency_abstained':
      return `abstained, ${ABSTENTION_LABEL[finding.abstention]}`
    case 'composure': {
      const named = finding.signals.map((signal) => COMPOSURE_LABEL[signal]).join(', ')
      // The same rule the ledger opens a gap on, so the debrief and the ledger cannot disagree.
      const held = finding.signals.every((signal) => COMPOSURE_HELD.includes(signal))
      return `${held ? 'held' : 'did not hold'} · ${named}`
    }
    case 'competency':
      return finding.levelMet === null ? 'met no level' : `met the ${finding.levelMet} anchor`
  }
}

function subjectOf(finding: LaneFinding): string {
  return finding.kind === 'claim' || finding.kind === 'claim_abstained'
    ? 'Claim'
    : SUBJECT_LABEL[finding.competency]
}

function citation(finding: LaneFinding, quotes: ReadonlyMap<string, string>): string {
  const quoted = finding.transcriptSpanIds
    .map((id) => quotes.get(id))
    .find((text) => text !== undefined)
  // Never a blank where evidence belongs. Without the text the span ids are still a citation someone
  // can follow, and inventing a quote is the one thing worse than printing an id.
  return quoted === undefined
    ? `Cited spans ${finding.transcriptSpanIds.join(', ')}`
    : `Your words: “${quoted.replace(/\s+/g, ' ').trim()}”`
}

export const COMPETENCE_HEADING = 'WHAT YOU KNOW · judged against the rubric, with the evidence'

export function renderCompetenceLane(
  lane: CompetenceLane,
  quotes: ReadonlyMap<string, string> = new Map(),
): string[] {
  const out = [COMPETENCE_HEADING, '-'.repeat(COMPETENCE_HEADING.length)]

  if (lane.findings.length === 0)
    out.push(
      lane.plan?.uncertainty.length
        ? '  No current evaluation remains; reassessment is required.'
        : '  No answer was evaluated in this session.',
      '',
    )
  for (const finding of lane.findings) {
    const confidence = finding.confidence.toFixed(2)
    out.push(
      `  ${subjectOf(finding)} — ${verdictOf(finding)} · confidence ${confidence} · judged at the ${finding.level} bar`,
      `    ${finding.rationale}`,
      `    ${citation(finding, quotes)}`,
      '',
    )
  }

  if (lane.gaps.length === 0) {
    out.push('  No gap opened or moved this session.')
  } else {
    out.push(
      '  Gaps touched this session',
      ...renderLedger(lane.gaps, quotes).map((row) => `  ${row}`),
    )
  }

  const declined =
    lane.abstentions === 0
      ? ''
      : ' · declined to judge rather than guess, which is a result and not a failure'
  out.push('', `  Abstentions      ${lane.abstentions}${declined}`)
  out.push(`  Pressure reached level ${lane.pressureReached} of 3`)
  return out
}
