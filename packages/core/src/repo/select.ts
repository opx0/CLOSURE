import type { Artifact, Claim, Evidence } from '@levelhead/contracts'
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
export function matchArtifacts(
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

export interface RankedArtifact {
  artifact: Artifact
  // The confirmed claim this code bears on, so the question can tie the file back to the résumé line.
  claim: Claim | null
}

export interface ArtifactRankInput {
  artifacts: readonly Artifact[]
  evidence: readonly Evidence[]
  // Confirmed claims, in confirmation order.
  claims: readonly Claim[]
}

// Code the candidate did not write, or that nobody would ask them to explain.
const SKIPPED_SEGMENTS = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  '__mocks__',
  'e2e',
  'fixtures',
  'testdata',
  'testing',
  'node_modules',
  'vendor',
  'third_party',
  'third-party',
  'bower_components',
  '.venv',
  'venv',
  'site-packages',
  'generated',
  '__generated__',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
])

const TEST_FILE = /[._-](test|spec)\.[^.]+$|^test_.*\.py$|^conftest\.py$/i
const GENERATED_FILE = /\.(gen|generated|min)\.[^.]+$|\.d\.[cm]?ts$|\.pb\.go$|_pb2(_grpc)?\.py$/i
const LOCKFILE = /[.-]lock\.(json|ya?ml)$|\.lockb?$|^go\.sum$/i
const CONFIG_FILE =
  /\.(json|ya?ml|toml|ini|cfg|conf|env|xml|properties)$|(^|[.-])config\.[cm]?[jt]sx?$|^\.[^.]+rc(\.[a-z]+)?$/i

const SKIPPED_NAMES: readonly RegExp[] = [TEST_FILE, GENERATED_FILE, LOCKFILE, CONFIG_FILE]

function skipped(artifact: Artifact): boolean {
  if (artifact.kind !== 'file' && artifact.kind !== 'function') return true
  const segments = artifact.path.split('/')
  const name = segments[segments.length - 1] ?? ''
  return (
    segments.some((segment) => SKIPPED_SEGMENTS.has(segment)) ||
    SKIPPED_NAMES.some((pattern) => pattern.test(name))
  )
}

// Long enough to have a decision in it, short enough to be read aloud in one question.
const MIN_SYMBOL_LINES = 8
const MAX_SYMBOL_LINES = 120

function sizeTier(artifact: Artifact): number {
  if (artifact.symbol === undefined) return 2
  const { startLine, endLine } = artifact
  if (startLine === undefined || endLine === undefined) return 1
  const lines = endLine - startLine + 1
  return lines >= MIN_SYMBOL_LINES && lines <= MAX_SYMBOL_LINES ? 0 : 1
}

interface Candidate {
  artifact: Artifact
  claim: Claim | null
  score: number
  tier: number
}

// Linking alone is not enough: a pin may link every artifact to every confirmed claim, and tying a
// file to a résumé line whose words it never mentions would put a claim in the question that the
// code does not bear on.
function linkedClaim(
  artifact: Artifact,
  claims: readonly Claim[],
  linked: ReadonlySet<string>,
): { claim: Claim | null; score: number } {
  let best: { claim: Claim | null; score: number } = { claim: null, score: 0 }
  for (const claim of claims) {
    if (!linked.has(claim.id)) continue
    const { score } = scoreArtifact(artifact, claimTerms(claim))
    if (score > best.score) best = { claim, score }
  }
  return best
}

function spreadAcrossFiles(ranked: readonly Candidate[]): Candidate[] {
  const seen = new Map<string, number>()
  return ranked
    .map((candidate, position) => {
      const occurrence = seen.get(candidate.artifact.path) ?? 0
      seen.set(candidate.artifact.path, occurrence + 1)
      return { candidate, occurrence, position }
    })
    .sort((a, b) => a.occurrence - b.occurrence || a.position - b.position)
    .map(({ candidate }) => candidate)
}

// What a walkthrough opens, in order: code a confirmed claim bears on first, then functions sized to
// be explained in one answer, spread across files. Deterministic, so replay reopens the same code.
export function rankArtifacts(input: ArtifactRankInput): RankedArtifact[] {
  const confirmed = new Set(input.claims.map((claim) => claim.id))
  const claimsByArtifact = new Map<string, Set<string>>()
  for (const link of input.evidence) {
    if (link.subject.kind !== 'claim' || link.target.kind !== 'artifact') continue
    if (!confirmed.has(link.subject.claimId)) continue
    const known = claimsByArtifact.get(link.target.artifactId) ?? new Set<string>()
    claimsByArtifact.set(link.target.artifactId, known.add(link.subject.claimId))
  }

  const candidates = input.artifacts
    .filter((artifact) => !skipped(artifact))
    .map((artifact): Candidate => {
      const linked = claimsByArtifact.get(artifact.id) ?? new Set<string>()
      const { claim, score } = linkedClaim(artifact, input.claims, linked)
      return { artifact, claim, score, tier: (claim === null ? 3 : 0) + sizeTier(artifact) }
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        a.artifact.path.localeCompare(b.artifact.path) ||
        (a.artifact.startLine ?? 0) - (b.artifact.startLine ?? 0),
    )

  const tiers = [...new Set(candidates.map((candidate) => candidate.tier))]
  return tiers.flatMap((tier) =>
    spreadAcrossFiles(candidates.filter((candidate) => candidate.tier === tier)).map(
      ({ artifact, claim }) => ({ artifact, claim }),
    ),
  )
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

export const LINKS_PER_CLAIM = 10

// Only code that shares terms with the claim is linked. Linking the whole snapshot would make every
// résumé line read as backed by code.
export function linkSnapshotToClaims(
  artifacts: readonly Artifact[],
  claims: readonly Claim[],
  ids: IdSource,
): Evidence[] {
  return claims.flatMap((claim) =>
    linkArtifactsToClaim(
      matchArtifacts(artifacts, claim, LINKS_PER_CLAIM).map((match) => match.artifact),
      claim,
      ids,
    ),
  )
}
