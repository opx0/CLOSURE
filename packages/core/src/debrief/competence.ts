import {
  COMPOSURE_HELD,
  widenFindings,
  type ClaimAbstention,
  type ClaimVerdict,
  type CompetenceLane,
  type Competency,
  type ComposureSignal,
} from '@levelhead/contracts'
import type { SessionView } from '../events/replay.ts'
import { renderLedger } from '../gaps/ledger.ts'

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

  if (lane.findings.length === 0) out.push('  No answer was evaluated in this session.', '')
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
