import type { Finding } from '@levelhead/contracts'

// Levelhead's honesty check, pointed at Levelhead. The same answer is re-run with identity-correlated
// surface signals stripped, and what comes back is the difference between the two evaluations.
//
// The difference, and nothing else. A delta on a handful of answers does not show that the Evaluator
// is biased, and no delta does not show that it is not. Asserting either would be exactly the
// unmeasured confidence this project exists to remove, so the boundary travels with the value.
export const AUDIT_BOUNDARY = 'reports_a_delta_never_a_conclusion_about_bias' as const

export type BlindTransform =
  | 'personal_names_masked'
  | 'institutions_masked'
  | 'gendered_pronouns_neutralised'
  | 'first_person_number_swapped'

export interface BlindVariant {
  readonly id: string
  readonly transforms: readonly BlindTransform[]
  readonly text: string
}

// Names and employers are supplied, never guessed. A capitalised-token heuristic would mask
// PostgreSQL and Kubernetes along with Priya and Ordinal Systems, and an audit that quietly deletes
// the technical content of an answer measures the wrong thing while looking like it worked.
export interface IdentitySurface {
  readonly names?: readonly string[]
  readonly institutions?: readonly string[]
}

export const NAME_PLACEHOLDER = '[NAME]'
export const INSTITUTION_PLACEHOLDER = '[ORG]'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchCase(replacement: string, original: string): string {
  const first = original[0]
  const head = replacement[0]
  if (first === undefined || head === undefined) return replacement
  if (first === first.toLowerCase()) return replacement
  return head.toUpperCase() + replacement.slice(1)
}

function maskAll(text: string, phrases: readonly string[], placeholder: string): string {
  // Longest first, so "Northgate Labs" is masked whole instead of leaving "Labs" behind.
  const ordered = [...phrases]
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase !== '')
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))

  let out = text
  for (const phrase of ordered) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`,
      'giu',
    )
    out = out.replace(pattern, placeholder)
  }
  return out
}

const NEUTRAL_PRONOUNS: readonly (readonly [RegExp, string])[] = [
  [/\bhimself\b/gi, 'themselves'],
  [/\bherself\b/gi, 'themselves'],
  [/\bhers\b/gi, 'theirs'],
  // English collapses the possessive and object forms of "her", so the following word decides:
  // "her runbook" is possessive, "told her" is not. The rewrite is published with the transcript,
  // so a reader can see where the rule guessed.
  [/\bher\b(?=\s+[\p{L}])/giu, 'their'],
  [/\bher\b/gi, 'them'],
  [/\bhis\b/gi, 'their'],
  [/\bhim\b/gi, 'them'],
  [/\bhe\b/gi, 'they'],
  [/\bshe\b/gi, 'they'],
]

function neutralisePronouns(text: string): string {
  let out = text
  for (const [pattern, neutral] of NEUTRAL_PRONOUNS) {
    out = out.replace(pattern, (matched) => matchCase(neutral, matched))
  }
  return out
}

const PLURAL_FIRST_PERSON = /\b(we|our|ours|us|ourselves)\b/gi
// Spelled out rather than given the `i` flag, so a bare lowercase "i" — a loop variable, in an
// answer about code — is never mistaken for the pronoun.
const SINGULAR_FIRST_PERSON = /\b(I|[Mm]y|[Mm]ine|[Mm]e|[Mm]yself)\b/g

const PLURAL_TO_SINGULAR = new Map([
  ['we', 'I'],
  ['our', 'my'],
  ['ours', 'mine'],
  ['us', 'me'],
  ['ourselves', 'myself'],
])

const SINGULAR_TO_PLURAL = new Map([
  ['i', 'we'],
  ['my', 'our'],
  ['mine', 'ours'],
  ['me', 'us'],
  ['myself', 'ourselves'],
])

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

// A separate confound from the others, and a real one: "we built" and "I built" describe the same
// work and read as different amounts of ownership. This swaps the number rather than neutralising
// it, because there is no neutral first person in English to swap to.
function swapFirstPersonNumber(text: string): string {
  const plural = countMatches(text, PLURAL_FIRST_PERSON)
  const singular = countMatches(text, SINGULAR_FIRST_PERSON)
  if (plural === 0 && singular === 0) return text

  const out =
    plural >= singular
      ? text.replace(PLURAL_FIRST_PERSON, (matched) => {
          const swapped = PLURAL_TO_SINGULAR.get(matched.toLowerCase()) ?? matched
          // "I" is capitalised everywhere in English, so it is exempt from case matching.
          return swapped === 'I' ? 'I' : matchCase(swapped, matched)
        })
      : text
          .replace(/(^|[.!?]\s+)I\b/g, (_whole, lead: string) => `${lead}We`)
          .replace(SINGULAR_FIRST_PERSON, (matched) => {
            const swapped = SINGULAR_TO_PLURAL.get(matched.toLowerCase()) ?? matched
            return matched === 'I' ? swapped : matchCase(swapped, matched)
          })

  // Agreement, fixed only on the verb the swapped pronoun governs. Leaving "I were" behind would
  // plant a new surface signal in the variant and measure that instead.
  return out
    .replace(/\bI\s+were\b/g, 'I was')
    .replace(/\bI\s+are\b/g, 'I am')
    .replace(/\b(We|we)\s+was\b/g, '$1 were')
    .replace(/\b(We|we)\s+am\b/g, '$1 are')
}

function apply(text: string, transform: BlindTransform, identity: IdentitySurface): string {
  switch (transform) {
    case 'personal_names_masked':
      return maskAll(text, identity.names ?? [], NAME_PLACEHOLDER)
    case 'institutions_masked':
      return maskAll(text, identity.institutions ?? [], INSTITUTION_PLACEHOLDER)
    case 'gendered_pronouns_neutralised':
      return neutralisePronouns(text)
    case 'first_person_number_swapped':
      return swapFirstPersonNumber(text)
  }
}

function variantId(transforms: readonly BlindTransform[]): string {
  return `blind:${transforms.join('+')}`
}

// Neutralisation only. The number swap is left out because it adds a surface signal rather than
// removing one, and folding it in here would make a combined delta impossible to attribute.
const NEUTRALISING: readonly BlindTransform[] = [
  'personal_names_masked',
  'institutions_masked',
  'gendered_pronouns_neutralised',
]

const ALL_TRANSFORMS: readonly BlindTransform[] = [...NEUTRALISING, 'first_person_number_swapped']

export function blindVariants(text: string, identity: IdentitySurface = {}): BlindVariant[] {
  const variants: BlindVariant[] = []
  let changedNeutralising = 0

  for (const transform of ALL_TRANSFORMS) {
    const rewritten = apply(text, transform, identity)
    // A transform that changed nothing has nothing to compare, and an identical pair reported as a
    // replay would inflate n without adding an observation.
    if (rewritten === text) continue

    if (NEUTRALISING.includes(transform)) changedNeutralising += 1
    variants.push({ id: variantId([transform]), transforms: [transform], text: rewritten })
  }

  if (changedNeutralising >= 2) {
    const combined = NEUTRALISING.reduce(
      (carried, transform) => apply(carried, transform, identity),
      text,
    )
    variants.push({ id: variantId(NEUTRALISING), transforms: NEUTRALISING, text: combined })
  }

  return variants
}

export type FindingPresence = 'in_both' | 'base_only' | 'variant_only'

export interface FindingDelta {
  readonly subject: string
  readonly presence: FindingPresence
  readonly verdictChanged: boolean
  readonly abstentionChanged: boolean
  // Variant minus base. Zero when the finding exists on one side only, because there is no pair.
  readonly confidenceShift: number
}

export interface AuditDelta {
  readonly compared: number
  readonly verdictChanges: number
  readonly abstentionChanges: number
  // The largest absolute move, so opposite shifts on two findings cannot cancel into "nothing moved".
  readonly largestConfidenceShift: number
  readonly perFinding: readonly FindingDelta[]
  readonly boundary: typeof AUDIT_BOUNDARY
}

// A verdict and an abstention on the same claim or competency share one subject on purpose: judging
// and declining to judge are the two outcomes a blinding could move between, and separate keys would
// hide that move as one finding appearing and another disappearing.
function subjectOf(finding: Finding): string {
  switch (finding.kind) {
    case 'claim':
    case 'claim_abstained':
      return `claim:${finding.claimId}`
    case 'composure':
      return `composure:${finding.competency}`
    case 'competency':
    case 'competency_abstained':
      return `competency:${finding.competency}`
  }
}

function verdictOf(finding: Finding): string | null {
  switch (finding.kind) {
    case 'claim':
      return finding.verdict
    case 'composure':
      return [...finding.signals].sort().join(',')
    case 'competency':
      return finding.levelMet ?? 'no_level_met'
    case 'claim_abstained':
    case 'competency_abstained':
      return null
  }
}

function abstentionOf(finding: Finding): string | null {
  return finding.kind === 'claim_abstained' || finding.kind === 'competency_abstained'
    ? finding.abstention
    : null
}

export function compareEvaluations(
  base: readonly Finding[],
  variant: readonly Finding[],
): AuditDelta {
  const variantBySubject = new Map(variant.map((finding) => [subjectOf(finding), finding]))
  const seen = new Set<string>()
  const perFinding: FindingDelta[] = []

  for (const baseFinding of base) {
    const subject = subjectOf(baseFinding)
    seen.add(subject)
    const other = variantBySubject.get(subject)

    if (other === undefined) {
      perFinding.push({
        subject,
        presence: 'base_only',
        verdictChanged: false,
        abstentionChanged: false,
        confidenceShift: 0,
      })
      continue
    }

    const baseVerdict = verdictOf(baseFinding)
    const otherVerdict = verdictOf(other)

    perFinding.push({
      subject,
      presence: 'in_both',
      // A side that abstained has no verdict to have changed; that move is the abstention change.
      verdictChanged: baseVerdict !== null && otherVerdict !== null && baseVerdict !== otherVerdict,
      abstentionChanged: abstentionOf(baseFinding) !== abstentionOf(other),
      confidenceShift: other.confidence - baseFinding.confidence,
    })
  }

  for (const variantFinding of variant) {
    const subject = subjectOf(variantFinding)
    if (seen.has(subject)) continue
    perFinding.push({
      subject,
      presence: 'variant_only',
      verdictChanged: false,
      abstentionChanged: false,
      confidenceShift: 0,
    })
  }

  return {
    compared: perFinding.filter((delta) => delta.presence === 'in_both').length,
    verdictChanges: perFinding.filter((delta) => delta.verdictChanged).length,
    abstentionChanges: perFinding.filter((delta) => delta.abstentionChanged).length,
    largestConfidenceShift: perFinding.reduce(
      (largest, delta) => Math.max(largest, Math.abs(delta.confidenceShift)),
      0,
    ),
    perFinding,
    boundary: AUDIT_BOUNDARY,
  }
}
