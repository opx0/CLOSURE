import { readFile } from 'node:fs/promises'
import { CLAIM_VERDICT_ORDER } from '@closer/contracts'
import type { ClaimType, ClaimVerdict, Competency } from '@closer/contracts'
import { isEvaluatorErrorClass, type EvaluatorErrorClass } from './error-taxonomy.ts'
import type { FixtureSet, LabelingDisclosure } from './contract.ts'
import type { GoldClaim } from './metrics.ts'

// JSONL, one record per line, with `#` comments and blank lines allowed - hand-editable without
// re-indenting a document or resolving a merge conflict in a nested array. Every record carries
// who labeled it and when, since GRRAS (Kottner et al. 2011, ticket 05 section 6) requires rater
// count and procedure disclosed.

interface LabelBase {
  labeller: string
  // ISO date: what makes it checkable that the ground truth predates the result it judges.
  labelledAt: string
  note: string
}

export type LabelRecord =
  | (LabelBase & { kind: 'resume_claim'; resumeId: string; quote: string; type: ClaimType })
  | (LabelBase & { kind: 'claim_verdict'; itemId: string; verdict: ClaimVerdict })
  | (LabelBase & { kind: 'evidence_supports'; itemId: string; quote: string; supports: boolean })
  | (LabelBase & { kind: 'gap_present'; itemId: string; competency: Competency; present: boolean })
  // How a disagreement failed, from the pre-declared taxonomy. Classified rather than described,
  // so an error can be counted without anyone inventing a severity for it.
  | (LabelBase & { kind: 'error_class'; itemId: string; errorClass: EvaluatorErrorClass })

export interface ParsedLabels {
  labels: LabelRecord[]
  // Line-numbered and never thrown away: a silently skipped line is a label the benchmark never read.
  errors: string[]
}

const CLAIM_TYPES: readonly ClaimType[] = ['built', 'designed', 'optimized', 'led', 'measured']
const COMPETENCIES: readonly Competency[] = [
  'mechanism',
  'trade_offs',
  'failure_modes',
  'composure',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function base(row: Record<string, unknown>): LabelBase | string {
  const labeller = str(row, 'labeller')
  const labelledAt = str(row, 'labelledAt')
  if (labeller === null) return 'labeller is required'
  if (labelledAt === null) return 'labelledAt is required'
  return { labeller, labelledAt, note: str(row, 'note') ?? '' }
}

function parseRow(row: Record<string, unknown>): LabelRecord | string {
  const common = base(row)
  if (typeof common === 'string') return common

  switch (row['kind']) {
    case 'resume_claim': {
      const resumeId = str(row, 'resumeId')
      const quote = str(row, 'quote')
      const type = row['type']
      if (resumeId === null || quote === null) return 'resume_claim needs resumeId and quote'
      if (!CLAIM_TYPES.includes(type as ClaimType)) return `unknown claim type ${String(type)}`
      return { ...common, kind: 'resume_claim', resumeId, quote, type: type as ClaimType }
    }
    case 'claim_verdict': {
      const itemId = str(row, 'itemId')
      const verdict = row['verdict']
      if (itemId === null) return 'claim_verdict needs itemId'
      // The two abstentions are deliberately not on this scale (contracts/claim.ts).
      if (!CLAIM_VERDICT_ORDER.includes(verdict as ClaimVerdict)) {
        return `unknown verdict ${String(verdict)}`
      }
      return { ...common, kind: 'claim_verdict', itemId, verdict: verdict as ClaimVerdict }
    }
    case 'evidence_supports': {
      const itemId = str(row, 'itemId')
      const quote = str(row, 'quote')
      if (itemId === null || quote === null) return 'evidence_supports needs itemId and quote'
      if (typeof row['supports'] !== 'boolean') return 'evidence_supports needs a boolean supports'
      return { ...common, kind: 'evidence_supports', itemId, quote, supports: row['supports'] }
    }
    case 'gap_present': {
      const itemId = str(row, 'itemId')
      const competency = row['competency']
      if (itemId === null) return 'gap_present needs itemId'
      if (!COMPETENCIES.includes(competency as Competency)) {
        return `unknown competency ${String(competency)}`
      }
      if (typeof row['present'] !== 'boolean') return 'gap_present needs a boolean present'
      return {
        ...common,
        kind: 'gap_present',
        itemId,
        competency: competency as Competency,
        present: row['present'],
      }
    }
    case 'error_class': {
      const itemId = str(row, 'itemId')
      const errorClass = row['errorClass']
      if (itemId === null) return 'error_class needs itemId'
      if (!isEvaluatorErrorClass(errorClass)) {
        return `unknown evaluator error class ${String(errorClass)}`
      }
      return { ...common, kind: 'error_class', itemId, errorClass }
    }
    default:
      return `unknown label kind ${String(row['kind'])}`
  }
}

export function parseLabels(text: string): ParsedLabels {
  const labels: LabelRecord[] = []
  const errors: string[] = []

  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      errors.push(`line ${index + 1}: not valid JSON`)
      continue
    }
    if (!isRecord(parsed)) {
      errors.push(`line ${index + 1}: expected an object`)
      continue
    }
    const record = parseRow(parsed)
    if (typeof record === 'string') errors.push(`line ${index + 1}: ${record}`)
    else labels.push(record)
  }

  return { labels, errors }
}

export async function loadLabels(path: string): Promise<ParsedLabels> {
  return parseLabels(await readFile(path, 'utf8'))
}

// Emits no verdicts: a template that pre-filled one would be a label nobody made.
export function labelTemplate(fixtures: FixtureSet, labeller: string, date: string): string {
  const lines = [
    `# CLOSER Bench labels for fixture set ${fixtures.id} v${fixtures.version}`,
    '# One JSON object per line. Blank lines and lines starting with # are ignored.',
    '#',
    '#   {"kind":"resume_claim","resumeId":"...","quote":"verbatim from the resume",',
    '#    "type":"built|designed|optimized|led|measured","labeller":"...","labelledAt":"YYYY-MM-DD","note":""}',
    '#   {"kind":"claim_verdict","itemId":"...","verdict":"supported|partially_supported|',
    '#    unsupported_by_available_evidence|contradicted","labeller":"...","labelledAt":"YYYY-MM-DD","note":""}',
    '#   {"kind":"evidence_supports","itemId":"...","quote":"words from an answer","supports":true,',
    '#    "labeller":"...","labelledAt":"YYYY-MM-DD","note":""}',
    '#   {"kind":"gap_present","itemId":"...","competency":"mechanism|trade_offs|failure_modes|composure",',
    '#    "present":true,"labeller":"...","labelledAt":"YYYY-MM-DD","note":""}',
    '#   {"kind":"error_class","itemId":"...","errorClass":"invented_credit|missed_gap|...",',
    '#    "labeller":"...","labelledAt":"YYYY-MM-DD","note":""}',
    '#',
    `# Prepared for ${labeller} on ${date}.`,
    `# Items awaiting a claim_verdict: ${fixtures.items.length}.`,
  ]
  for (const item of fixtures.items) lines.push(`#   ${item.id}  ${item.claim.assertion}`)
  return `${lines.join('\n')}\n`
}

export class LabelIndex {
  readonly #labels: readonly LabelRecord[]

  constructor(labels: readonly LabelRecord[]) {
    this.#labels = labels
  }

  labellers(): string[] {
    return [...new Set(this.#labels.map((label) => label.labeller))].sort()
  }

  goldClaims(resumeId: string): GoldClaim[] {
    return this.#labels.flatMap((label) =>
      label.kind === 'resume_claim' && label.resumeId === resumeId
        ? [{ quote: label.quote, type: label.type }]
        : [],
    )
  }

  supportingQuotes(itemId: string): string[] {
    return this.#labels.flatMap((label) =>
      label.kind === 'evidence_supports' && label.itemId === itemId && label.supports
        ? [label.quote]
        : [],
    )
  }

  verdicts(itemId: string): { labeller: string; verdict: ClaimVerdict }[] {
    return this.#labels.flatMap((label) =>
      label.kind === 'claim_verdict' && label.itemId === itemId
        ? [{ labeller: label.labeller, verdict: label.verdict }]
        : [],
    )
  }

  // Plurality; a tie is left unresolved rather than broken, which would invent ground truth on
  // exactly the items the labellers found hardest.
  adjudicated(itemId: string): ClaimVerdict | null {
    const counts = new Map<ClaimVerdict, number>()
    for (const { verdict } of this.verdicts(itemId)) {
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1)
    }
    let best: ClaimVerdict | null = null
    let bestCount = 0
    let tied = false
    for (const [verdict, count] of counts) {
      if (count > bestCount) {
        best = verdict
        bestCount = count
        tied = false
      } else if (count === bestCount) {
        tied = true
      }
    }
    return tied ? null : best
  }

  errorClasses(): EvaluatorErrorClass[] {
    return this.#labels.flatMap((label) => (label.kind === 'error_class' ? [label.errorClass] : []))
  }

  verdictUnits(): string[] {
    return [
      ...new Set(
        this.#labels.flatMap((label) => (label.kind === 'claim_verdict' ? [label.itemId] : [])),
      ),
    ].sort()
  }
}

export interface RatingsMatrix {
  units: readonly string[]
  raters: readonly string[]
  // Units x raters, the shape `krippendorffOrdinalAlpha` expects. Null means "this rater did not
  // label this unit", not a missing unit.
  ratings: (number | null)[][]
}

// The ordinal scale is CLAIM_VERDICT_ORDER and no other; the two abstentions stay off it so they
// can never enter the computation.
export function humanRatingsMatrix(index: LabelIndex): RatingsMatrix {
  const units = index.verdictUnits()
  const raters = index.labellers()
  const ratings = units.map((unit) => {
    const byRater = new Map(index.verdicts(unit).map((v) => [v.labeller, v.verdict]))
    return raters.map((rater) => {
      const verdict = byRater.get(rater)
      return verdict === undefined ? null : CLAIM_VERDICT_ORDER.indexOf(verdict)
    })
  })
  return { units, raters, ratings }
}

// Model-human alpha is meaningless without human-human alpha on the same items (section 5), so
// the model enters as one more rater column over exactly the units the humans labeled.
export function withModelRater(
  matrix: RatingsMatrix,
  modelVerdict: (itemId: string) => ClaimVerdict | null,
): RatingsMatrix {
  return {
    units: matrix.units,
    raters: [...matrix.raters, 'model'],
    ratings: matrix.ratings.map((row, at) => {
      const unit = matrix.units[at]
      const verdict = unit === undefined ? null : modelVerdict(unit)
      return [...row, verdict === null ? null : CLAIM_VERDICT_ORDER.indexOf(verdict)]
    }),
  }
}

// Ticket 05 section 6, pre-declared: the flagship agreement gate does not fire at all below this.
export const FLAGSHIP_AGREEMENT_MIN_N = 100

export interface AgreementAssertability {
  n: number
  assertable: boolean
  reason: string
}

// Below n = 100, alpha still ships with its interval - only the pass/fail is withheld.
export function agreementAssertability(matrix: RatingsMatrix): AgreementAssertability {
  const n = matrix.ratings.filter((row) => row.some((value) => value !== null)).length
  if (n < FLAGSHIP_AGREEMENT_MIN_N) {
    return {
      n,
      assertable: false,
      reason: `n = ${n} labeled units is below the pre-declared minimum of ${FLAGSHIP_AGREEMENT_MIN_N}; alpha is published with its interval and no pass or fail is asserted`,
    }
  }
  if (matrix.raters.length < 2) {
    return {
      n,
      assertable: false,
      reason: 'agreement needs at least two raters; a single rater agrees with themselves',
    }
  }
  return {
    n,
    assertable: true,
    reason: `n = ${n} labeled units across ${matrix.raters.length} raters`,
  }
}

// soloSelfLabeled is computed rather than asserted so it cannot be forgotten (GRRAS, section 6).
export function labelingDisclosure(index: LabelIndex): LabelingDisclosure {
  const labellers = index.labellers()
  return {
    labellers,
    soloSelfLabeled: labellers.length <= 1,
    coefficient: "Krippendorff's ordinal alpha, with Gwet's AC2 reported beside it",
    coefficientRationale:
      'plain and weighted kappa are excluded by the kappa paradox on a skewed rubric (research 03); intervals are percentile bootstrap, not Wald, at this n',
    adjudication:
      'plurality across labellers; a tie is left unresolved rather than broken, so no ground truth is invented on the items labellers disagreed about',
    labeledUnits: index.verdictUnits().length,
  }
}
