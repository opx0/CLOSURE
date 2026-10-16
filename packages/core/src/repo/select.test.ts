import { expect, test } from 'bun:test'
import type { Artifact, Claim, Evidence } from '@levelhead/contracts'
import type { IdSource } from '../ports/clock.ts'
import {
  linkArtifactsToClaim,
  linkSnapshotToClaims,
  matchArtifacts,
  rankArtifacts,
} from './select.ts'

const SNAPSHOT = 'snapshot_1'

function artifact(path: string, symbol?: string, lines: [number, number] = [10, 20]): Artifact {
  return {
    id: symbol === undefined ? `art_${path}` : `art_${path}#${symbol}`,
    snapshotId: SNAPSHOT,
    kind: symbol === undefined ? 'file' : 'function',
    path,
    ...(symbol === undefined ? {} : { symbol, startLine: lines[0], endLine: lines[1] }),
  }
}

const ARTIFACTS: Artifact[] = [
  artifact('src/api/router.ts'),
  artifact('src/api/router.ts', 'registerRoutes'),
  artifact('src/queue.ts'),
  artifact('src/queue.ts', 'claimJob'),
  artifact('src/theme/colors.ts'),
  artifact('src/theme/colors.ts', 'palette'),
]

const QUEUE_CLAIM: Claim = {
  id: 'claim_1',
  spanId: 'span_1',
  type: 'built',
  assertion: 'Built a job queue with leases in Postgres',
  technologies: ['Postgres', 'TypeScript'],
  metrics: [],
  implied: false,
  confirmedByCandidate: true,
  extractorVersion: 'claim-extraction@v1',
}

function counterIds(): IdSource {
  let n = 0
  return { next: (prefix) => `${prefix}_${(n += 1)}` }
}

test('a claim about a job queue surfaces queue.ts and claimJob, not the first file alphabetically', () => {
  const selected = matchArtifacts(ARTIFACTS, QUEUE_CLAIM, 3).map((match) => match.artifact)

  expect(selected.map((found) => [found.path, found.symbol])).toEqual([
    ['src/queue.ts', 'claimJob'],
    ['src/queue.ts', undefined],
  ])
})

test('an artifact that matches nothing is dropped, not ranked last', () => {
  const ranked = matchArtifacts(ARTIFACTS, QUEUE_CLAIM, 10)

  expect(ranked.map((match) => match.artifact.path)).not.toContain('src/theme/colors.ts')
  expect(ranked.map((match) => match.matched)).toEqual([['job', 'queue'], ['queue']])
  expect(matchArtifacts(ARTIFACTS, QUEUE_CLAIM, 0)).toEqual([])
})

test('a named technology outweighs a word from the prose', () => {
  const claim: Claim = { ...QUEUE_CLAIM, assertion: 'Built the router', technologies: ['Postgres'] }
  const artifacts = [artifact('src/router.ts'), artifact('src/db/postgres.ts')]

  expect(matchArtifacts(artifacts, claim, 2).map((match) => match.artifact.path)).toEqual([
    'src/db/postgres.ts',
    'src/router.ts',
  ])
})

test('ties are broken by path then symbol, and the same input always ranks the same way', () => {
  const tied = [
    artifact('src/b/queue.ts', 'flush'),
    artifact('src/a/queue.ts', 'flush'),
    artifact('src/a/queue.ts', 'drain'),
  ]
  const order = matchArtifacts(tied, QUEUE_CLAIM, 3).map((match) => [
    match.artifact.path,
    match.artifact.symbol,
  ])

  expect(order).toEqual([
    ['src/a/queue.ts', 'drain'],
    ['src/a/queue.ts', 'flush'],
    ['src/b/queue.ts', 'flush'],
  ])
  expect(matchArtifacts([...tied].reverse(), QUEUE_CLAIM, 3).map((m) => m.artifact.id)).toEqual(
    matchArtifacts(tied, QUEUE_CLAIM, 3).map((m) => m.artifact.id),
  )
})

test('linking records repository_observed evidence from the claim to each artifact', () => {
  const selected = matchArtifacts(ARTIFACTS, QUEUE_CLAIM, 2).map((match) => match.artifact)

  expect(linkArtifactsToClaim(selected, QUEUE_CLAIM, counterIds())).toEqual([
    {
      id: 'evidence_1',
      subject: { kind: 'claim', claimId: 'claim_1' },
      target: { kind: 'artifact', artifactId: 'art_src/queue.ts#claimJob' },
      trust: 'repository_observed',
    },
    {
      id: 'evidence_2',
      subject: { kind: 'claim', claimId: 'claim_1' },
      target: { kind: 'artifact', artifactId: 'art_src/queue.ts' },
      trust: 'repository_observed',
    },
  ])
})

test('pinning links a claim only to the code that shares its terms', () => {
  const links = linkSnapshotToClaims(ARTIFACTS, [QUEUE_CLAIM], counterIds())

  expect(links.map((link) => link.target)).toEqual(
    matchArtifacts(ARTIFACTS, QUEUE_CLAIM, 10).map((match) => ({
      kind: 'artifact',
      artifactId: match.artifact.id,
    })),
  )
  expect(links.length).toBeLessThan(ARTIFACTS.length)
})

function opened(ranked: ReturnType<typeof rankArtifacts>): string[] {
  return ranked.map(({ artifact: found }) =>
    found.symbol === undefined ? found.path : `${found.path}#${found.symbol}`,
  )
}

function linksTo(claim: Claim, artifacts: readonly Artifact[]): Evidence[] {
  return linkArtifactsToClaim(artifacts, claim, counterIds())
}

test('a walkthrough opens the candidate’s own code, never tests, config, generated or vendored files', () => {
  const repository = [
    artifact('src/queue.ts', 'claimJob'),
    artifact('src/queue.test.ts', 'claimsTwice'),
    artifact('tests/queue_helpers.py', 'make_job'),
    artifact('worker/lease_test.go', 'TestLease'),
    artifact('src/api/schema.gen.ts', 'routes'),
    artifact('vendor/lib/pool.go', 'Acquire'),
    artifact('node_modules/pg/index.js', 'connect'),
    artifact('vite.config.ts', 'config'),
    artifact('package.json'),
    artifact('bun.lock'),
    artifact('src/types.d.ts', 'Job'),
  ]

  expect(opened(rankArtifacts({ artifacts: repository, evidence: [], claims: [] }))).toEqual([
    'src/queue.ts#claimJob',
  ])
})

test('functions sized to explain in one answer come first, one per file before a second', () => {
  const repository = [
    artifact('src/a.ts'),
    artifact('src/a.ts', 'tiny', [1, 3]),
    artifact('src/a.ts', 'parse', [10, 40]),
    artifact('src/a.ts', 'render', [50, 90]),
    artifact('src/b.ts', 'huge', [1, 400]),
    artifact('src/c.ts', 'schedule', [5, 30]),
  ]

  expect(opened(rankArtifacts({ artifacts: repository, evidence: [], claims: [] }))).toEqual([
    'src/a.ts#parse',
    'src/c.ts#schedule',
    'src/a.ts#render',
    'src/a.ts#tiny',
    'src/b.ts#huge',
    'src/a.ts',
  ])
})

test('code a confirmed claim bears on comes first and carries the claim with it', () => {
  const repository = [
    artifact('src/api/router.ts', 'registerRoutes'),
    artifact('src/queue.ts', 'claimJob'),
    artifact('src/theme/colors.ts', 'palette'),
  ]
  const ranked = rankArtifacts({
    artifacts: repository,
    evidence: linksTo(QUEUE_CLAIM, repository),
    claims: [QUEUE_CLAIM],
  })

  expect(opened(ranked)).toEqual([
    'src/queue.ts#claimJob',
    'src/api/router.ts#registerRoutes',
    'src/theme/colors.ts#palette',
  ])
  // Linked to everything by the pin, but only the queue code is about the queue claim.
  expect(ranked.map((found) => found.claim?.id ?? null)).toEqual(['claim_1', null, null])
})

test('a claim that is not confirmed, or not linked, puts no claim on the code', () => {
  const repository = [artifact('src/queue.ts', 'claimJob')]
  const unconfirmed = rankArtifacts({
    artifacts: repository,
    evidence: linksTo(QUEUE_CLAIM, repository),
    claims: [],
  })
  const unlinked = rankArtifacts({ artifacts: repository, evidence: [], claims: [QUEUE_CLAIM] })

  expect(unconfirmed.map((found) => found.claim)).toEqual([null])
  expect(unlinked.map((found) => found.claim)).toEqual([null])
})

test('the same repository always opens in the same order', () => {
  const repository = [
    artifact('src/b.ts', 'flush', [30, 60]),
    artifact('src/a.ts', 'drain', [40, 70]),
    artifact('src/a.ts', 'fill', [5, 35]),
  ]
  const forward = rankArtifacts({ artifacts: repository, evidence: [], claims: [] })
  const backward = rankArtifacts({ artifacts: [...repository].reverse(), evidence: [], claims: [] })

  expect(opened(forward)).toEqual(['src/a.ts#fill', 'src/b.ts#flush', 'src/a.ts#drain'])
  expect(opened(backward)).toEqual(opened(forward))
})
