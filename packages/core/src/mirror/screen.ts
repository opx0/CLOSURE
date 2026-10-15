import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  MIRROR_BOUNDARY,
  type Artifact,
  type Claim,
  type Evidence,
  type ScreenFlag,
  type ScreenSimulation,
  type Span,
  type TermCoverage,
  type Untrusted,
} from '@levelhead/contracts'
import { resolveSpan } from '../events/sources.ts'
import { DEFAULT_TERM_LIMIT, extractRequiredTerms, type RequiredTerm } from './terms.ts'

// The verbs a keyword screen reads as "was nearby when it happened". Listed in the order they are
// emitted, so a claim carrying two of them flags the same way on every run. The canonical form is
// what the flag reports; the patterns also catch the inflections a résumé actually uses.
export const VAGUE_VERBS: readonly { readonly verb: string; readonly pattern: RegExp }[] = [
  { verb: 'assisted', pattern: /\bassist(?:ed|ing|s)?\b/i },
  { verb: 'helped', pattern: /\bhelp(?:ed|ing|s)?\b/i },
  { verb: 'involved in', pattern: /\binvolved\s+(?:in|with)\b/i },
  { verb: 'participated in', pattern: /\bparticipat(?:ed|ing|es|e)\s+in\b/i },
  { verb: 'worked on', pattern: /\bwork(?:ed|ing|s)?\s+on\b/i },
]

// A repository pinned to a commit, with the evidence links that reach into it. Supplying it turns on
// `claim_unsupported_by_snapshot`; leaving it out means the question was never asked, which is not
// the same answer as "no support found".
export interface PinnedSnapshot {
  readonly snapshotId: string
  readonly artifacts: readonly Artifact[]
  readonly evidence: readonly Evidence[]
}

export interface ScreenInput {
  readonly jobDescription: Untrusted<string>
  readonly resumeText: Untrusted<string>
  readonly resumeSourceId: string
  // Spans over `resumeText`. A term the mirror cannot place inside one of these is reported absent:
  // a hit the candidate cannot open and look at is not evidence, and a citation with nothing behind
  // it is worse than a blank. To screen a whole document, pass a span covering the whole document.
  readonly spans: readonly Span[]
  readonly claims: readonly Claim[]
  readonly snapshot?: PinnedSnapshot
  readonly termLimit?: number
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-bounded so "queue" does not match inside "queued", and whitespace-flexible so a phrase still
// matches across the line break a résumé bullet wraps on.
function matcherFor(term: string): RegExp {
  const parts = term.split(' ').map(escapeRegExp)
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
}

interface ByteRange {
  readonly startByte: number
  readonly endByte: number
}

function occurrencesOf(text: string, term: string): ByteRange[] {
  const found: ByteRange[] = []
  for (const match of text.matchAll(matcherFor(term))) {
    const startByte = Buffer.byteLength(text.slice(0, match.index), 'utf8')
    found.push({ startByte, endByte: startByte + Buffer.byteLength(match[0], 'utf8') })
  }
  return found
}

// A span whose offsets do not reproduce its own quoted bytes is dropped rather than cited. The
// mirror reports where a term was found, and a broken span is not a where.
function citableSpans(input: ScreenInput): Span[] {
  const sources = new Map<string, string>([[input.resumeSourceId, input.resumeText]])
  return input.spans.filter(
    (span) => span.sourceId === input.resumeSourceId && resolveSpan(span, sources).ok,
  )
}

function coverageFor(
  terms: readonly RequiredTerm[],
  resumeText: string,
  spans: readonly Span[],
): TermCoverage[] {
  return terms.map((required) => {
    const spanIds: string[] = []
    for (const at of occurrencesOf(resumeText, required.term)) {
      for (const span of spans) {
        const inside = span.startByte <= at.startByte && at.endByte <= span.endByte
        if (inside && !spanIds.includes(span.id)) spanIds.push(span.id)
      }
    }
    return { term: required.term, present: spanIds.length > 0, spanIds }
  })
}

function supportedBySnapshot(claimId: string, snapshot: PinnedSnapshot): boolean {
  const inSnapshot = new Set(
    snapshot.artifacts
      .filter((artifact) => artifact.snapshotId === snapshot.snapshotId)
      .map((artifact) => artifact.id),
  )

  return snapshot.evidence.some(
    (evidence) =>
      evidence.subject.kind === 'claim' &&
      evidence.subject.claimId === claimId &&
      evidence.target.kind === 'artifact' &&
      inSnapshot.has(evidence.target.artifactId),
  )
}

function claimFlags(
  claims: readonly Claim[],
  spans: readonly Span[],
  snapshot: PinnedSnapshot | undefined,
): ScreenFlag[] {
  const quotedById = new Map(spans.map((span) => [span.id, span.quoted]))
  const flags: ScreenFlag[] = []

  for (const claim of claims) {
    if (claim.metrics.length === 0)
      flags.push({ kind: 'claim_states_no_outcome', claimId: claim.id })

    // The screen on the other side reads the résumé, not the extractor's normalised assertion, so
    // the verb is looked for in the candidate's own words. No span, no reading, no flag.
    const quoted = quotedById.get(claim.spanId)
    if (quoted !== undefined) {
      for (const vague of VAGUE_VERBS) {
        if (vague.pattern.test(quoted)) {
          flags.push({ kind: 'claim_verb_is_vague', claimId: claim.id, verb: vague.verb })
        }
      }
    }

    if (snapshot !== undefined && !supportedBySnapshot(claim.id, snapshot)) {
      flags.push({
        kind: 'claim_unsupported_by_snapshot',
        claimId: claim.id,
        snapshotId: snapshot.snapshotId,
      })
    }
  }

  return flags
}

export function simulateScreen(input: ScreenInput): ScreenSimulation {
  const terms = extractRequiredTerms(input.jobDescription, input.termLimit ?? DEFAULT_TERM_LIMIT)
  const spans = citableSpans(input)
  const coverage = coverageFor(terms, input.resumeText, spans)

  const flags: ScreenFlag[] = coverage
    .filter((entry) => !entry.present)
    .map((entry) => ({ kind: 'required_term_absent', term: entry.term }))

  flags.push(...claimFlags(input.claims, spans, input.snapshot))

  return {
    jobDescriptionHash: createHash('sha256').update(input.jobDescription).digest('hex'),
    coverage,
    flags,
    boundary: MIRROR_BOUNDARY,
  }
}

export function renderScreen(simulation: ScreenSimulation): string[] {
  const covered = simulation.coverage.filter((entry) => entry.present)
  const lines = [
    'screen mirror — a model of an outside system, never a judgment of you',
    `  required terms  ${covered.length} of ${simulation.coverage.length} resolve to a span in your résumé`,
  ]

  for (const entry of simulation.coverage) {
    const where = entry.present ? entry.spanIds.join(', ') : 'nowhere in your résumé'
    lines.push(`  ${entry.present ? '·' : '!'} ${entry.term.padEnd(28)}${where}`)
  }

  for (const flag of simulation.flags) {
    lines.push(`  flag  ${flagLine(flag)}`)
  }

  // There is no match percentage on purpose: a number here would be the aggregate this project
  // forbids under another name, and it would tell the candidate nothing they could act on.
  lines.push('  This is a guess about what a keyword screen would extract. It is not a verdict on')
  lines.push('  your work, it produces no match number, and nothing in it reaches the Evaluator.')
  return lines
}

function flagLine(flag: ScreenFlag): string {
  switch (flag.kind) {
    case 'required_term_absent':
      return `"${flag.term}" appears in the posting and nowhere in your résumé`
    case 'claim_states_no_outcome':
      return `${flag.claimId} says what you did, not what changed`
    case 'claim_verb_is_vague':
      return `${flag.claimId} leads with "${flag.verb}", which reads as proximity, not ownership`
    case 'claim_unsupported_by_snapshot':
      return `${flag.claimId} has no artifact evidence in snapshot ${flag.snapshotId}`
  }
}
