import type { EvaluatorPort } from '@closer/core'
import { ScriptedEvaluator } from '../../../apps/cli/src/testing/fakes.ts'
import type { FixtureSet } from '../contract.ts'
import type { LabelRecord } from '../labels.ts'

// Everything here is constructed, exercising the harness end to end without a model call; the
// fixture set it builds is marked `synthetic: true`.

// Every scripted answer contains this, so one canned evaluation output resolves its citation in
// every answer of every arm.
export const SHARED_QUOTE = 'the queue'

export const SYNTHETIC_RESUME_TEXT = [
  'SYNTHETIC FIXTURE - not a real resume.',
  'Built a durable job queue in Postgres with at-least-once delivery.',
  'Designed a retry policy with exponential backoff.',
].join('\n')

export const SYNTHETIC_CLAIM_QUOTE = 'Built a durable job queue in Postgres'

export function syntheticFixtures(injectionCanary: string | null = null): FixtureSet {
  return {
    id: 'synthetic-harness-check',
    version: 1,
    synthetic: true,
    resumes: [{ id: 'resume-synthetic', text: SYNTHETIC_RESUME_TEXT }],
    items: [
      {
        id: 'item-synthetic-1',
        resumeId: 'resume-synthetic',
        claim: {
          quote: SYNTHETIC_CLAIM_QUOTE,
          type: 'built',
          assertion: 'built a durable job queue',
          technologies: ['Postgres'],
          metrics: [],
        },
        answers: [
          {
            text: `We leased from the queue with SELECT FOR UPDATE SKIP LOCKED and a thirty second visibility timeout.`,
            insufficientEvidence: false,
          },
          {
            text: `We used the standard retry policy on the queue, so failed jobs came back around fine.`,
            insufficientEvidence: true,
          },
        ],
        repoChunks: [
          { path: 'src/queue.ts', text: 'async function lease() { /* the queue leases a job */ }' },
          { path: 'src/http.ts', text: 'export function route() { /* unrelated distractor */ }' },
        ],
        injection: injectionCanary === null ? null : { canary: injectionCanary, where: 'answer' },
      },
    ],
  }
}

export function syntheticLabels(labeller = 'fixture-author'): LabelRecord[] {
  const labelledAt = '2026-09-09'
  return [
    {
      kind: 'resume_claim',
      resumeId: 'resume-synthetic',
      quote: SYNTHETIC_CLAIM_QUOTE,
      type: 'built',
      labeller,
      labelledAt,
      note: 'synthetic',
    },
    {
      kind: 'claim_verdict',
      itemId: 'item-synthetic-1',
      verdict: 'partially_supported',
      labeller,
      labelledAt,
      note: 'synthetic',
    },
    {
      kind: 'evidence_supports',
      itemId: 'item-synthetic-1',
      quote: `We leased from ${SHARED_QUOTE} with SELECT FOR UPDATE SKIP LOCKED`,
      supports: true,
      labeller,
      labelledAt,
      note: 'synthetic',
    },
  ]
}

// One claim verbatim in the resume, one not: CLOSER drops the second for an unresolved span, the
// generic arm keeps it - the citation discipline the extraction metric shows.
export const SCRIPTED_EXTRACTION = {
  claims: [
    {
      quote: SYNTHETIC_CLAIM_QUOTE,
      assertion: 'built a durable job queue',
      type: 'built',
      technologies: ['Postgres'],
      metrics: [],
      implied: false,
    },
    {
      quote: 'Achieved 99.99% uptime across the fleet',
      assertion: 'ran the fleet at four nines',
      type: 'measured',
      technologies: [],
      metrics: ['99.99%'],
      implied: true,
    },
  ],
}

export const SCRIPTED_EVALUATION = {
  findings: [
    {
      kind: 'claim',
      verdict: 'partially_supported',
      rationale: 'The lease mechanism is named, but nothing establishes the delivery guarantee.',
      confidence: 0.7,
      quotes: [SHARED_QUOTE],
    },
  ],
}

// Routes by output schema, not call order, since the arms call in an order the test shouldn't have
// to predict. Both branches are `ScriptedEvaluator`, so values are still validated against the
// real schemas.
export function routingEvaluator(depth = 64): EvaluatorPort {
  const extraction = new ScriptedEvaluator(Array.from({ length: depth }, () => SCRIPTED_EXTRACTION))
  const evaluation = new ScriptedEvaluator(Array.from({ length: depth }, () => SCRIPTED_EVALUATION))
  return {
    complete: (request) =>
      request.schemaName === 'ExtractedClaims'
        ? extraction.complete(request)
        : evaluation.complete(request),
  }
}
