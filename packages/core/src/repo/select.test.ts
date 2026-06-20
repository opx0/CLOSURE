import { expect, test } from 'bun:test'
import type { Artifact, Claim } from '@closer/contracts'
import type { IdSource } from '../ports/clock.ts'
import { linkArtifactsToClaim, rankArtifacts, selectArtifacts } from './select.ts'

const SNAPSHOT = 'snapshot_1'

function artifact(path: string, symbol?: string): Artifact {
  return {
    id: symbol === undefined ? `art_${path}` : `art_${path}#${symbol}`,
    snapshotId: SNAPSHOT,
    kind: symbol === undefined ? 'file' : 'function',
    path,
    ...(symbol === undefined ? {} : { symbol, startLine: 10, endLine: 20 }),
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
  const selected = selectArtifacts(ARTIFACTS, QUEUE_CLAIM, 3)

  expect(selected.map((found) => [found.path, found.symbol])).toEqual([
    ['src/queue.ts', 'claimJob'],
    ['src/queue.ts', undefined],
  ])
})

test('an artifact that matches nothing is dropped, not ranked last', () => {
  const ranked = rankArtifacts(ARTIFACTS, QUEUE_CLAIM, 10)

  expect(ranked.map((match) => match.artifact.path)).not.toContain('src/theme/colors.ts')
  expect(ranked.map((match) => match.matched)).toEqual([['job', 'queue'], ['queue']])
  expect(selectArtifacts(ARTIFACTS, QUEUE_CLAIM, 0)).toEqual([])
})

test('a named technology outweighs a word from the prose', () => {
  const claim: Claim = { ...QUEUE_CLAIM, assertion: 'Built the router', technologies: ['Postgres'] }
  const artifacts = [artifact('src/router.ts'), artifact('src/db/postgres.ts')]

  expect(rankArtifacts(artifacts, claim, 2).map((match) => match.artifact.path)).toEqual([
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
  const order = rankArtifacts(tied, QUEUE_CLAIM, 3).map((match) => [
    match.artifact.path,
    match.artifact.symbol,
  ])

  expect(order).toEqual([
    ['src/a/queue.ts', 'drain'],
    ['src/a/queue.ts', 'flush'],
    ['src/b/queue.ts', 'flush'],
  ])
  expect(rankArtifacts([...tied].reverse(), QUEUE_CLAIM, 3).map((m) => m.artifact.id)).toEqual(
    rankArtifacts(tied, QUEUE_CLAIM, 3).map((m) => m.artifact.id),
  )
})

test('linking records repository_observed evidence from the claim to each artifact', () => {
  const selected = selectArtifacts(ARTIFACTS, QUEUE_CLAIM, 2)

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
