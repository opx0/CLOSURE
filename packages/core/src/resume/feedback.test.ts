import { expect, test } from 'bun:test'
import type {
  Artifact,
  Claim,
  ClaimVerdict,
  Evidence,
  Finding,
  GapEntry,
  GapStatus,
  ResumeFeedback,
  ResumeTag,
  Span,
} from '@levelhead/contracts'
import { resumeFeedback, type ResumeFeedbackInput } from './feedback.ts'

function span(id: string, startByte: number, quoted: string): Span {
  return {
    id,
    sourceId: 'resume:0123456789ab',
    startByte,
    endByte: startByte + quoted.length,
    quoted,
  }
}

function claim(id: string, spanId: string, over: Partial<Claim> = {}): Claim {
  return {
    id,
    spanId,
    type: 'built',
    assertion: 'built a durable job queue',
    technologies: [],
    metrics: [],
    implied: false,
    confirmedByCandidate: false,
    extractorVersion: 'claim-extraction@v1#0123456789abcdef',
    ...over,
  }
}

function inputOf(over: Partial<ResumeFeedbackInput>): ResumeFeedbackInput {
  return {
    spans: [],
    claims: [],
    confirmedClaimIds: new Set(),
    snapshotIds: [],
    artifacts: [],
    evidence: [],
    findings: [],
    quotes: new Map(),
    gaps: [],
    ...over,
  }
}

const judged = {
  attemptId: 'att-1',
  rubric: { id: 'claim_status', version: 1 },
  level: 'junior' as const,
  rationale: 'Judged against the junior anchor.',
  confidence: 0.8,
  modelVersion: 'test-model',
  promptVersion: '1',
  transcriptSpanIds: ['tspan-1'] as [string],
}

function verdictOn(
  id: string,
  claimId: string,
  verdict: ClaimVerdict,
  evidenceIds: [string, ...string[]],
): Finding {
  return { ...judged, id, evidenceIds, kind: 'claim', claimId, verdict }
}

function abstainedOn(id: string, claimId: string): Finding {
  return {
    ...judged,
    id,
    evidenceIds: ['ev-said-1'],
    kind: 'claim_abstained',
    claimId,
    abstention: 'insufficient_evidence',
  }
}

function transcriptLink(id: string, claimId: string): Evidence {
  return {
    id,
    subject: { kind: 'claim', claimId },
    target: { kind: 'span', spanId: `tspan-${id}` },
    trust: 'transcript_observed',
  }
}

function codeLink(id: string, claimId: string, artifactId: string): Evidence {
  return {
    id,
    subject: { kind: 'claim', claimId },
    target: { kind: 'artifact', artifactId },
    trust: 'repository_observed',
  }
}

function gap(id: string, claimId: string | undefined, status: GapStatus, cites: string): GapEntry {
  return {
    id,
    competency: 'mechanism',
    ...(claimId === undefined ? {} : { claimId }),
    summary: 'Recovery after a lease expires is not explained.',
    status,
    findingIds: [`finding-${id}`],
    evidenceIds: [cites],
    openedAt: '2026-09-20T10:00:00.000Z',
    lastTouchedAt: '2026-09-22T10:00:00.000Z',
    transferAttemptIds: [],
  }
}

const verdictKinds: readonly string[] = ['held', 'partially_supported', 'contradicted']

function verdictTags(feedback: ResumeFeedback): ResumeTag[] {
  return feedback.lines.flatMap((line) => line.tags).filter((t) => verdictKinds.includes(t.kind))
}

const queueLine = span('span-queue', 0, 'Built a durable job queue on PostgreSQL')
const cacheLine = span('span-cache', 40, 'Added a read-through cache to the catalog API')
const teamLine = span('span-team', 90, 'Led a team of four through the migration')

const resumeLink: Evidence = {
  id: 'ev-resume-queue',
  subject: { kind: 'claim', claimId: 'claim-queue' },
  target: { kind: 'span', spanId: 'span-queue' },
  trust: 'candidate_asserted',
}

const quotes = new Map([
  ['ev-resume-queue', 'Built a durable job queue on PostgreSQL'],
  ['ev-said-1', 'leases expire after thirty seconds'],
  ['ev-said-2', 'we never handled a worker coming back after its lease expired'],
  ['ev-said-3', 'invalidation happens on write, I think'],
  ['ev-said-4', 'I split the migration into four tracks'],
  ['ev-said-5', 'the reaper requeues anything past its lease'],
])

test('with nothing pinned, an implied optimisation with no number is flagged three ways', () => {
  const feedback = resumeFeedback(
    inputOf({
      spans: [span('span-latency', 0, 'Improved API latency with caching')],
      claims: [claim('claim-latency', 'span-latency', { type: 'optimized', implied: true })],
    }),
  )

  expect(feedback).toEqual({
    lines: [
      {
        spanId: 'span-latency',
        text: 'Improved API latency with caching',
        claimIds: ['claim-latency'],
        tags: [
          {
            kind: 'implied_unconfirmed',
            claimId: 'claim-latency',
            advice:
              'This is read into your wording rather than stated; confirm it only if you can explain it in depth, otherwise reword the line so it stops implying it.',
            quotes: [],
            findingIds: [],
            gapIds: [],
            artifactPaths: [],
          },
          {
            kind: 'no_metric',
            claimId: 'claim-latency',
            advice:
              'Add the number you measured and its baseline; the first follow-up to this line is “by how much, measured how?”',
            quotes: [],
            findingIds: [],
            gapIds: [],
            artifactPaths: [],
          },
          {
            kind: 'code_not_checked',
            claimId: 'claim-latency',
            advice:
              'Not checked against code because no repository is pinned; pin the project behind this line so it can be cross-questioned file by file.',
            quotes: [],
            findingIds: [],
            gapIds: [],
            artifactPaths: [],
          },
        ],
      },
    ],
    snapshotIds: [],
  })
})

test('a confirmed implied claim and a measurement with its number raise neither flag', () => {
  const feedback = resumeFeedback(
    inputOf({
      spans: [span('span-p99', 0, 'Measured p99 latency at 40 ms')],
      claims: [
        claim('claim-p99', 'span-p99', { type: 'measured', implied: true, metrics: ['40 ms'] }),
      ],
      confirmedClaimIds: new Set(['claim-p99']),
    }),
  )

  expect(feedback.lines.flatMap((line) => line.tags).map((t) => t.kind)).toEqual([
    'code_not_checked',
  ])
})

test('with a repository pinned, linked code backs a claim by path and unlinked claims have none', () => {
  const artifacts: Artifact[] = [
    {
      id: 'art-lease',
      snapshotId: 'snap-2',
      kind: 'function',
      path: 'src/queue/lease.ts',
      symbol: 'claimJob',
      startLine: 12,
      endLine: 48,
    },
    {
      id: 'art-renew',
      snapshotId: 'snap-2',
      kind: 'function',
      path: 'src/queue/lease.ts',
      symbol: 'renewLease',
      startLine: 50,
      endLine: 71,
    },
    { id: 'art-worker', snapshotId: 'snap-2', kind: 'file', path: 'src/queue/worker.ts' },
    { id: 'art-old', snapshotId: 'snap-1', kind: 'file', path: 'src/legacy/cache.ts' },
  ]

  const feedback = resumeFeedback(
    inputOf({
      spans: [queueLine, cacheLine, teamLine],
      claims: [
        claim('claim-queue', 'span-queue'),
        claim('claim-cache', 'span-cache'),
        claim('claim-team', 'span-team', { type: 'led' }),
      ],
      snapshotIds: ['snap-2'],
      artifacts,
      evidence: [
        codeLink('ev-code-1', 'claim-queue', 'art-worker'),
        codeLink('ev-code-2', 'claim-queue', 'art-renew'),
        codeLink('ev-code-3', 'claim-queue', 'art-lease'),
        codeLink('ev-code-4', 'claim-cache', 'art-old'),
      ],
    }),
  )

  const noCode = (claimId: string): ResumeTag => ({
    kind: 'no_code_evidence',
    claimId,
    advice:
      'Nothing in your pinned repositories links to this line; pin the repository that holds this work, or be ready to explain it with no code to point at.',
    quotes: [],
    findingIds: [],
    gapIds: [],
    artifactPaths: [],
  })

  expect(feedback.lines.map((line) => line.tags)).toEqual([
    [
      {
        kind: 'linked_code',
        claimId: 'claim-queue',
        advice:
          'Files in your pinned repository share words with this line. That is what an interviewer may open, not proof the code backs it: expect to explain why they are written this way and what breaks them.',
        quotes: [],
        findingIds: [],
        gapIds: [],
        artifactPaths: ['src/queue/lease.ts', 'src/queue/worker.ts'],
      },
    ],
    [noCode('claim-cache')],
    [noCode('claim-team')],
  ])
  expect(feedback.snapshotIds).toEqual(['snap-2'])
})

test('the most recent claim finding sets the verdict and quotes the answer, never the résumé line', () => {
  const shardLine = span('span-shard', 140, 'Sharded the events table by tenant')

  const feedback = resumeFeedback(
    inputOf({
      spans: [queueLine, cacheLine, teamLine, shardLine],
      claims: [
        claim('claim-queue', 'span-queue'),
        claim('claim-cache', 'span-cache'),
        claim('claim-team', 'span-team', { type: 'led' }),
        claim('claim-shard', 'span-shard'),
      ],
      evidence: [
        resumeLink,
        transcriptLink('ev-said-1', 'claim-queue'),
        transcriptLink('ev-said-2', 'claim-queue'),
        transcriptLink('ev-said-3', 'claim-cache'),
        transcriptLink('ev-said-4', 'claim-team'),
      ],
      findings: [
        verdictOn('finding-1', 'claim-queue', 'supported', ['ev-said-1', 'ev-resume-queue']),
        verdictOn('finding-2', 'claim-cache', 'partially_supported', ['ev-said-3', 'ev-said-3']),
        verdictOn('finding-3', 'claim-queue', 'contradicted', ['ev-said-2', 'ev-resume-queue']),
        verdictOn('finding-4', 'claim-team', 'supported', ['ev-said-4', 'ev-unquoted']),
        verdictOn('finding-5', 'claim-shard', 'supported', ['ev-said-5']),
        verdictOn('finding-6', 'claim-shard', 'unsupported_by_available_evidence', ['ev-said-5']),
      ],
      quotes,
    }),
  )

  expect(verdictTags(feedback)).toEqual([
    {
      kind: 'contradicted',
      claimId: 'claim-queue',
      advice:
        'Your own answer contradicted this line. Rewrite it to what you can defend, or prepare the mechanism before an interviewer asks.',
      quotes: ['we never handled a worker coming back after its lease expired'],
      findingIds: ['finding-3'],
      gapIds: [],
      artifactPaths: [],
    },
    {
      kind: 'partially_supported',
      claimId: 'claim-cache',
      advice:
        'Your answer covered only part of this line; narrow it to what you explained, or prepare the part you could not.',
      quotes: ['invalidation happens on write, I think'],
      findingIds: ['finding-2'],
      gapIds: [],
      artifactPaths: [],
    },
    {
      kind: 'held',
      claimId: 'claim-team',
      advice: 'Your answer held up on this line; keep it, and keep the explanation you gave.',
      quotes: ['I split the migration into four tracks'],
      findingIds: ['finding-4'],
      gapIds: [],
      artifactPaths: [],
    },
  ])
})

test('an abstention never produces a verdict and never overwrites one', () => {
  const feedback = resumeFeedback(
    inputOf({
      spans: [queueLine, cacheLine],
      claims: [claim('claim-queue', 'span-queue'), claim('claim-cache', 'span-cache')],
      findings: [
        abstainedOn('finding-1', 'claim-queue'),
        verdictOn('finding-2', 'claim-cache', 'contradicted', ['ev-said-3']),
        abstainedOn('finding-3', 'claim-cache'),
        {
          ...judged,
          id: 'finding-4',
          evidenceIds: ['ev-said-1'],
          kind: 'competency_abstained',
          competency: 'mechanism',
          abstention: 'not_verifiable',
        },
      ],
      quotes,
    }),
  )

  expect(feedback.lines.map((line) => line.tags.map((t) => t.kind))).toEqual([
    ['code_not_checked'],
    ['code_not_checked', 'contradicted'],
  ])
  expect(verdictTags(feedback).map((t) => t.findingIds)).toEqual([['finding-2']])
})

test('open and drilled gaps on a claim become one open_gap tag carrying their citations', () => {
  const feedback = resumeFeedback(
    inputOf({
      spans: [queueLine, cacheLine],
      claims: [claim('claim-queue', 'span-queue'), claim('claim-cache', 'span-cache')],
      evidence: [resumeLink],
      gaps: [
        gap('gap-1', 'claim-queue', 'open', 'ev-said-2'),
        gap('gap-2', 'claim-queue', 'unverified', 'ev-said-1'),
        gap('gap-3', 'claim-queue', 'drilled', 'ev-resume-queue'),
        gap('gap-4', 'claim-queue', 'closed_under_transfer', 'ev-said-4'),
        gap('gap-5', 'claim-cache', 'unverified', 'ev-said-3'),
        gap('gap-6', undefined, 'open', 'ev-said-5'),
      ],
      quotes,
    }),
  )

  expect(feedback.lines.map((line) => line.tags.filter((t) => t.kind === 'open_gap'))).toEqual([
    [
      {
        kind: 'open_gap',
        claimId: 'claim-queue',
        advice:
          'This line has a gap that has not yet held under a transfer question; close it before an interviewer who reads this line finds it.',
        quotes: ['we never handled a worker coming back after its lease expired'],
        findingIds: ['finding-gap-1', 'finding-gap-3'],
        gapIds: ['gap-1', 'gap-3'],
        artifactPaths: [],
      },
    ],
    [],
  ])
})

test('one line per résumé span with a claim, in résumé order, each claim’s tags in claim order', () => {
  const feedback = resumeFeedback(
    inputOf({
      spans: [
        span('span-c', 120, 'Wrote the on-call runbook'),
        span('span-a', 0, 'Built a durable job queue on PostgreSQL'),
        span('span-none', 60, 'Coursework: Operating Systems, Databases'),
        span('span-b', 40, 'Optimized and measured the ingest path'),
      ],
      claims: [
        claim('claim-b2', 'span-b', { type: 'measured' }),
        claim('claim-a', 'span-a'),
        claim('claim-b1', 'span-b', { type: 'optimized' }),
        claim('claim-c', 'span-c'),
        claim('claim-lost', 'span-elsewhere'),
      ],
    }),
  )

  expect(
    feedback.lines.map((line) => [line.spanId, line.claimIds, line.tags.map((t) => t.claimId)]),
  ).toEqual([
    ['span-a', ['claim-a'], ['claim-a']],
    ['span-b', ['claim-b2', 'claim-b1'], ['claim-b2', 'claim-b2', 'claim-b1', 'claim-b1']],
    ['span-c', ['claim-c'], ['claim-c']],
  ])
})
