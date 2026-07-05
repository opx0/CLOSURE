import { afterAll, expect, test } from 'bun:test'
import { LOCAL_OWNER_ID, type Artifact, type Snapshot } from '@closer/contracts'
import { PostgresRetrieval, searchStatement, splitIdentifiers } from './retrieval.ts'
import { toQuery } from './postgres-event-store.ts'
import { runMigrations } from './migrations/runner.ts'
import { openTestDatabase } from './testing/postgres.ts'

// A claim's words arrive as ordinary prose. websearch_to_tsquery treats an apostrophe or an
// operator in candidate text as text; plainto_/to_tsquery would let it become query syntax.
test('the query is built from untrusted prose, never concatenated into query syntax', () => {
  const { sql, params } = toQuery(
    searchStatement(LOCAL_OWNER_ID, 'snapshot_1', "lease' OR 1=1 --", 5),
  )

  expect(sql).toContain('websearch_to_tsquery')
  expect(sql).not.toContain('OR 1=1')
  expect(params).toContain('lease or 1 1')
})

// Source code is not English prose: without this, a search for "claim job" cannot reach `claimJob`
// and a search for `claimJob` cannot reach a sentence about claiming a job.
test('identifiers and prose are split into the same word stream', () => {
  expect(splitIdentifiers('claimJob')).toBe('claim job')
  expect(splitIdentifiers('MAX_ATTEMPTS')).toBe('max attempts')
  expect(splitIdentifiers('src/queue.ts')).toBe('src queue ts')
  expect(splitIdentifiers('HTTPServer')).toBe('http server')
})

const url = process.env.DATABASE_URL
const database =
  url === undefined ? undefined : await openTestDatabase(url, 'closer_retrieval_test')

if (database === undefined) {
  test.skip('packages/db retrieval integration tests: DATABASE_URL is unset or unreachable', () => {})
} else {
  await runMigrations(database.pool)
  const retrieval = new PostgresRetrieval(database.pool)

  const snapshot: Snapshot = {
    id: 'snapshot_1',
    repoPath: '/srv/queue',
    commit: 'c'.repeat(40),
    pinnedAt: '2026-09-10T00:00:00.000Z',
    fileCount: 2,
  }

  const artifact = (id: string, path: string, symbol?: string): Artifact => ({
    id,
    snapshotId: snapshot.id,
    kind: symbol === undefined ? 'file' : 'function',
    path,
    ...(symbol === undefined ? {} : { symbol }),
  })

  afterAll(() => database.close())

  test('a symbol outranks the same word buried in another file’s body', async () => {
    await retrieval.recordSnapshot(LOCAL_OWNER_ID, snapshot, 'hash')
    await retrieval.index(LOCAL_OWNER_ID, snapshot.id, [
      {
        artifact: artifact('artifact_1', 'src/queue.ts', 'claimJob'),
        text: 'async function claimJob() { acquire a lease with a thirty second expiry }',
      },
      {
        artifact: artifact('artifact_2', 'src/report.ts'),
        text: 'a report mentions the word lease once, in passing, among other words',
      },
    ])

    const hits = await retrieval.search(LOCAL_OWNER_ID, snapshot.id, 'claimJob lease', 5)
    expect(hits[0]?.artifact.id).toBe('artifact_1')
    expect(hits[0]?.excerpt.length).toBeGreaterThan(0)

    // The claim's own words, in prose, still reach the identifier they name.
    const prose = await retrieval.search(LOCAL_OWNER_ID, snapshot.id, 'claim a job', 5)
    expect(prose[0]?.artifact.id).toBe('artifact_1')
  })

  test('one owner never retrieves another owner’s snapshot', async () => {
    const hits = await retrieval.search('someone-else', snapshot.id, 'lease', 5)
    expect(hits).toEqual([])
  })

  // Deleting the bytes is what deletion means; the tombstone in the event log is what keeps the
  // citation. Leaving the index behind would be keeping the content under another name.
  test('marking a snapshot deleted drops its indexed content', async () => {
    await retrieval.markDeleted(
      LOCAL_OWNER_ID,
      snapshot.id,
      'candidate_requested',
      snapshot.pinnedAt,
    )

    expect(await retrieval.search(LOCAL_OWNER_ID, snapshot.id, 'lease', 5)).toEqual([])
    expect(await retrieval.liveSnapshots(LOCAL_OWNER_ID)).toEqual([])
  })
}
