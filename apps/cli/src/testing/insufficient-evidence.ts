import type { Claim } from '@levelhead/contracts'

// `cue` is the substring an abstaining evaluator cites, so the abstention is evidenced like any finding.
export interface InsufficientEvidenceCase {
  id: string
  answer: string
  cue: string
  why: string
}

export const INSUFFICIENT_EVIDENCE: readonly InsufficientEvidenceCase[] = [
  {
    id: 'standard-retry-policy',
    answer: 'We used the standard retry policy, so failed jobs came back around fine.',
    cue: 'the standard retry policy',
    why: 'names a policy without stating what it retries, how often, or with what backoff',
  },
  {
    id: 'the-usual-approach',
    answer: 'Nothing exotic — the usual approach for a queue like that.',
    cue: 'the usual approach',
    why: 'defers to a convention that is never described, so there is no mechanism to judge',
  },
  {
    id: 'best-practices',
    answer: 'We followed best practices for idempotency and it held up.',
    cue: 'followed best practices',
    why: 'asserts an outcome and cites a label rather than a mechanism',
  },
  {
    id: 'team-handled-it',
    answer: 'The team handled that part, and it worked well for us.',
    cue: 'The team handled that part',
    why: 'places the work outside the candidate, so the claim is neither supported nor contradicted',
  },
  {
    id: 'i-do-not-remember',
    answer: 'Honestly I do not remember the details of how the lease was renewed.',
    cue: 'I do not remember the details',
    why: 'an honest non-answer: judging it as unsupported would punish the honesty, not the gap',
  },
  {
    id: 'framework-did-it',
    answer: 'The framework did it for us, so we never had to think about that case.',
    cue: 'The framework did it for us',
    why: 'attributes the mechanism to a dependency without naming what the dependency does',
  },
]

export const ABSTENTION_CLAIM: Claim = {
  id: 'claim_seed_0001',
  spanId: 'span_seed_0001',
  type: 'built',
  assertion: 'built a durable job queue on PostgreSQL',
  technologies: ['PostgreSQL'],
  metrics: ['10k jobs/day'],
  implied: false,
  confirmedByCandidate: true,
  extractorVersion: 'claim-extraction@v1#seeded',
}

// Abstention is a value on the finding, never a null verdict and never an error (contracts/claim.ts).
export function abstained(cue: string, why: string): unknown {
  return {
    findings: [
      {
        kind: 'claim_abstained',
        abstention: 'insufficient_evidence',
        rationale: why,
        confidence: 0.5,
        quotes: [cue],
      },
    ],
  }
}

// The negative control: an evaluator that never declines, even on these answers.
export function neverAbstains(cue: string): unknown {
  return {
    findings: [
      {
        kind: 'claim',
        verdict: 'unsupported_by_available_evidence',
        rationale: 'no mechanism was described',
        confidence: 0.6,
        quotes: [cue],
      },
    ],
  }
}

// Computed by code from existing findings — never a number the model chose.
export function abstentionRate(kinds: readonly string[]): number {
  if (kinds.length === 0) return 0
  return (
    kinds.filter((kind) => kind === 'claim_abstained' || kind === 'competency_abstained').length /
    kinds.length
  )
}
