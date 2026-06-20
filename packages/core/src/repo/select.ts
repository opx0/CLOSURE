import type { Artifact, Claim, Evidence } from '@closer/contracts'
import type { IdSource } from '../ports/clock.ts'

export interface ArtifactMatch {
  artifact: Artifact
  score: number
  // The claim terms this artifact matched, sorted — so "why this file" is answerable, not a black box.
  matched: string[]
}

// A named technology is a stronger signal than a word from the surrounding prose.
const TECHNOLOGY_WEIGHT = 3
const ASSERTION_WEIGHT = 1

// A symbol name is the tighter match. `queue.ts` says the area; `claimJob` says the code.
const SYMBOL_SITE = 3
const PATH_SITE = 2

// Words that appear in every claim and in every path, and so separate nothing.
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'was',
  'were',
  'has',
  'had',
  'our',
  'its',
  'per',
  'via',
  'using',
  'used',
  'use',
  'app',
  'src',
  'lib',
  'code',
  'file',
  'files',
  'system',
  'service',
  'new',
  'main',
  'index',
])

const MIN_TERM_LENGTH = 3

// camelCase, snake_case, kebab-case and dotted paths all become the same word list.
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word))
}

function pathTokens(path: string): string[] {
  const at = path.lastIndexOf('.')
  return tokenize(at === -1 ? path : path.slice(0, at))
}

interface Term {
  word: string
  weight: number
}

function claimTerms(claim: Claim): Term[] {
  const terms = new Map<string, number>()
  const add = (word: string, weight: number): void => {
    terms.set(word, Math.max(terms.get(word) ?? 0, weight))
  }
  for (const technology of claim.technologies) {
    for (const word of tokenize(technology)) add(word, TECHNOLOGY_WEIGHT)
  }
  for (const word of tokenize(claim.assertion)) add(word, ASSERTION_WEIGHT)
  return [...terms].map(([word, weight]) => ({ word, weight }))
}

function siteWeight(artifact: Artifact, term: string): number {
  const symbol = artifact.symbol === undefined ? [] : tokenize(artifact.symbol)
  if (symbol.includes(term)) return SYMBOL_SITE
  return pathTokens(artifact.path).includes(term) ? PATH_SITE : 0
}

function scoreArtifact(artifact: Artifact, terms: readonly Term[]): ArtifactMatch {
  let score = 0
  const matched: string[] = []
  for (const term of terms) {
    const site = siteWeight(artifact, term.word)
    if (site === 0) continue
    score += term.weight * site
    matched.push(term.word)
  }
  return { artifact, score, matched: matched.sort() }
}

// Deterministic: no clock, no randomness, ties broken by path then symbol — replay-reproducible,
// like a policy action. An artifact that matches nothing is dropped rather than ranked last; padding
// the list with the next file alphabetically would spend §4.8's force on a coincidence.
export function rankArtifacts(
  artifacts: readonly Artifact[],
  claim: Claim,
  limit: number,
): ArtifactMatch[] {
  if (limit <= 0) return []
  const terms = claimTerms(claim)
  return artifacts
    .map((artifact) => scoreArtifact(artifact, terms))
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.artifact.path.localeCompare(b.artifact.path) ||
        (a.artifact.symbol ?? '').localeCompare(b.artifact.symbol ?? ''),
    )
    .slice(0, limit)
}

// What the session loop asks for: the artifacts themselves, in the order `rankArtifacts` put them.
export function selectArtifacts(
  artifacts: readonly Artifact[],
  claim: Claim,
  limit: number,
): Artifact[] {
  return rankArtifacts(artifacts, claim, limit).map((match) => match.artifact)
}

// `repository_observed` says only that the claim and artifact belong in the same question — never
// that the candidate wrote, understands, or is truthful about it. Evidence of knowledge is a later
// finding, from the answer (§4.8, §7).
export function linkArtifactsToClaim(
  artifacts: readonly Artifact[],
  claim: Claim,
  ids: IdSource,
): Evidence[] {
  return artifacts.map((artifact) => ({
    id: ids.next('evidence'),
    subject: { kind: 'claim', claimId: claim.id },
    target: { kind: 'artifact', artifactId: artifact.id },
    trust: 'repository_observed',
  }))
}
