import { afterAll, describe, expect, test, setDefaultTimeout } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Snapshot } from '@levelhead/contracts'
import type { EmbeddingPort, IndexedArtifact } from '@levelhead/core'
import { LocalEmbeddingAdapter } from '../../../apps/cli/src/adapters/embedding-local.ts'
import { PostgresRetrieval } from './retrieval.ts'
import { runMigrations } from './migrations/runner.ts'
import { openTestDatabase } from './testing/postgres.ts'

// Explicit opt-in is required. Once selected, missing DB/model dependencies are failures.
const selected = process.env.RETRIEVAL_INTEGRATION === '1'
if (selected) setDefaultTimeout(60_000)
describe.skipIf(!selected)(
  'required native PostgreSQL/pgvector + local embedding integration',
  () => {
    const setup = (async () => {
      if (!selected) return undefined
      const url = process.env.DATABASE_URL
      if (!url)
        throw new Error('RETRIEVAL_INTEGRATION requires an explicit disposable DATABASE_URL')
      const db = await openTestDatabase(url, `retrieval_${randomUUID().replaceAll('-', '')}`)
      if (!db) throw new Error('Required retrieval PostgreSQL is unavailable')
      try {
        await runMigrations(db.pool)
      } catch (error) {
        await db.close()
        throw error
      }
      return db
    })()
    afterAll(async () => {
      await (await setup)?.close()
    })
    const embedding = new LocalEmbeddingAdapter({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'all-minilm:22m',
      revision: '1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef',
      dimensions: 384,
      maxInputTokens: 256,
    })
    async function fixture(port: EmbeddingPort = embedding) {
      const db = await setup
      if (!db) throw new Error('Required integration not selected')
      const snapshot: Snapshot = {
        id: randomUUID(),
        repoPath: 'authored://integration',
        commit: 'a'.repeat(40),
        pinnedAt: new Date().toISOString(),
        fileCount: 2,
      }
      const owner = `owner-${randomUUID()}`
      const entries: IndexedArtifact[] = [
        {
          artifact: {
            id: randomUUID(),
            snapshotId: snapshot.id,
            kind: 'function',
            path: 'queue.ts',
            symbol: 'claimJob',
            startLine: 10,
            endLine: 12,
          },
          text: 'function claimJob() {\n  // Acquire a queue lease with a row lock.\n}\n',
        },
        {
          artifact: {
            id: randomUUID(),
            snapshotId: snapshot.id,
            kind: 'file',
            path: 'stack.ts',
            startLine: 1,
            endLine: 1,
          },
          text: '// A stack removes its most recently added item first.',
        },
      ]
      const retrieval = new PostgresRetrieval(db.pool, { embedding: port, chunkMaxTokens: 192 })
      await retrieval.recordSnapshot(owner, snapshot, 'authored-content-v1')
      return { db, owner, snapshot, entries, retrieval }
    }

    test('actual exact cosine agrees with an in-memory oracle; FTS/hybrid retain full artifact bounds', async () => {
      const { retrieval, owner, snapshot, entries } = await fixture()
      await retrieval.index(owner, snapshot.id, entries)
      const query = 'queue lease row lock'
      const vector = await embedding.embedQuery(query)
      const documents = await embedding.embedDocuments(entries.map((entry) => entry.text))
      const oracle = documents
        .map((document, index) => ({
          id: entries[index]!.artifact.id,
          score: document.reduce((sum, value, i) => sum + value * vector[i]!, 0),
        }))
        .sort((a, b) => b.score - a.score)
      const dense = await retrieval.search(owner, snapshot.id, query, 2, { strategy: 'dense' })
      expect(dense.map((hit) => hit.artifact.id)).toEqual(oracle.map((hit) => hit.id))
      dense.forEach((hit, index) => expect(hit.rank).toBeCloseTo(oracle[index]!.score, 5))
      for (const strategy of ['lexical', 'hybrid'] as const) {
        const hits = await retrieval.search(owner, snapshot.id, query, 2, { strategy })
        expect(hits[0]?.artifact.id).toBe(entries[0]!.artifact.id)
        expect(hits[0]?.artifact.startLine).toBe(10)
        expect(hits[0]?.artifact.endLine).toBe(12)
        expect(await retrieval.search(owner, snapshot.id, query, 2, { strategy })).toEqual(hits)
      }
    })

    test('owner/snapshot/profile isolation and explicit unavailable strategies', async () => {
      const { retrieval, db, owner, snapshot, entries } = await fixture()
      await retrieval.index(owner, snapshot.id, entries)
      for (const strategy of ['lexical', 'dense', 'hybrid'] as const) {
        expect(await retrieval.search('other', snapshot.id, 'lease', 3, { strategy })).toEqual([])
        expect(await retrieval.search(owner, 'missing', 'lease', 3, { strategy })).toEqual([])
      }
      const wrong = new PostgresRetrieval(db.pool, {
        embedding: {
          profile: { ...embedding.profile, id: 'wrong' },
          embedQuery: (text) => embedding.embedQuery(text),
          embedDocuments: (texts) => embedding.embedDocuments(texts),
        },
      })
      await expect(
        wrong.search(owner, snapshot.id, 'lease', 2, { strategy: 'dense' }),
      ).rejects.toThrow('profile mismatch')
      await expect(
        new PostgresRetrieval(db.pool).search(owner, snapshot.id, 'lease', 2, {
          strategy: 'dense',
        }),
      ).rejects.toThrow('unavailable')
    })

    test('stable cache reuses vectors on retry and changed artifact IDs; deletion removes all source/cache rows', async () => {
      let inputs = 0
      const port: EmbeddingPort = {
        profile: embedding.profile,
        embedQuery: (text) => embedding.embedQuery(text),
        embedDocuments: async (texts) => {
          inputs += texts.length
          return embedding.embedDocuments(texts)
        },
      }
      const { retrieval, db, owner, snapshot, entries } = await fixture(port)
      await retrieval.index(owner, snapshot.id, entries)
      const first = inputs
      await retrieval.index(owner, snapshot.id, entries)
      await retrieval.index(
        owner,
        snapshot.id,
        entries.map((entry) => ({ ...entry, artifact: { ...entry.artifact, id: randomUUID() } })),
      )
      expect(inputs).toBe(first)
      expect(first).toBe(2)
      await retrieval.markDeleted(owner, snapshot.id, 'test', new Date().toISOString())
      for (const table of [
        'artifact_index',
        'retrieval_chunks',
        'retrieval_vectors',
        'retrieval_publications',
      ]) {
        const { rows } = await db.pool.query(
          `select count(*)::int as n from ${table} where owner_id=$1 and snapshot_id=$2`,
          [owner, snapshot.id],
        )
        expect(rows[0]?.['n']).toBe(0)
      }
      expect(await retrieval.isLive(owner, snapshot.id)).toBe(false)
      await expect(retrieval.index(owner, snapshot.id, entries)).rejects.toThrow('deleted')
      await expect(
        retrieval.recordSnapshot(owner, snapshot, 'authored-content-v1'),
      ).rejects.toThrow('tombstone')
    })

    test('deleted metadata remains owner-scoped and discoverable after all live content is removed', async () => {
      const { db, owner, snapshot, entries } = await fixture()
      const retrieval = new PostgresRetrieval(db.pool)
      await retrieval.index(owner, snapshot.id, entries)
      expect(await retrieval.deletedSnapshots(owner)).toEqual([])
      const deletedAt = '2026-10-18T01:02:03.456Z'
      await expect(
        retrieval.markDeleted('other_owner', snapshot.id, 'candidate_requested', deletedAt),
      ).rejects.toThrow('owner mismatch')
      expect(await retrieval.deletedSnapshots(owner)).toEqual([])
      await retrieval.markDeleted(owner, snapshot.id, 'candidate_requested', deletedAt)
      await retrieval.markDeleted(owner, snapshot.id, 'retention_expired', new Date().toISOString())
      expect(await retrieval.liveSnapshots(owner)).toEqual([])
      expect(await retrieval.deletedSnapshots('other_owner')).toEqual([])
      expect(await retrieval.deletedSnapshots(owner)).toEqual([
        {
          snapshot,
          contentHash: 'authored-content-v1',
          reason: 'candidate_requested',
          deletedAt,
        },
      ])
      expect(await retrieval.search(owner, snapshot.id, 'lease', 2)).toEqual([])
      for (const table of [
        'artifact_index',
        'retrieval_chunks',
        'retrieval_vectors',
        'retrieval_publications',
      ]) {
        const { rows } = await db.pool.query(
          `select count(*)::int as n from ${table} where owner_id=$1 and snapshot_id=$2`,
          [owner, snapshot.id],
        )
        expect(rows[0]?.['n']).toBe(0)
      }
    })

    test('failed publication rolls back and cannot overwrite a different owner artifact', async () => {
      const a = await fixture()
      await a.retrieval.index(a.owner, a.snapshot.id, a.entries)
      const b = await fixture()
      const conflicting = b.entries.map((entry, index) => ({
        ...entry,
        artifact: { ...entry.artifact, id: a.entries[index]!.artifact.id },
      }))
      await expect(b.retrieval.index(b.owner, b.snapshot.id, conflicting)).rejects.toThrow(
        'collision',
      )
      expect(await b.retrieval.isLive(b.owner, b.snapshot.id)).toBe(false)
      expect((await a.retrieval.search(a.owner, a.snapshot.id, 'lease', 2)).length).toBe(1)
    })

    test('replacement failure rolls back previous chunks and publication; encoding recipes are immutable', async () => {
      const f = await fixture()
      await f.retrieval.index(f.owner, f.snapshot.id, f.entries)
      const before = await f.retrieval.search(f.owner, f.snapshot.id, 'lease', 3)
      // Duplicate stable chunk key fails after the old publication/chunks were removed in-transaction.
      await expect(
        f.retrieval.index(f.owner, f.snapshot.id, [f.entries[0]!, f.entries[0]!]),
      ).rejects.toThrow('duplicate key')
      expect(await f.retrieval.search(f.owner, f.snapshot.id, 'lease', 3)).toEqual(before)
      const changed: EmbeddingPort = {
        profile: { ...embedding.profile, preprocessingVersion: 'changed-with-same-id' },
        embedDocuments: (texts) => embedding.embedDocuments(texts),
        embedQuery: (text) => embedding.embedQuery(text),
      }
      await expect(
        new PostgresRetrieval(f.db.pool, { embedding: changed, chunkMaxTokens: 192 }).index(
          f.owner,
          f.snapshot.id,
          f.entries,
        ),
      ).rejects.toThrow('profile collision')
      expect(await f.retrieval.search(f.owner, f.snapshot.id, 'lease', 3)).toEqual(before)
    })

    test('invalid vectors never publish a partial snapshot', async () => {
      for (const invalid of [[0, 0], Array(384).fill(0), Array(384).fill(NaN)]) {
        const port: EmbeddingPort = {
          profile: embedding.profile,
          embedQuery: (text) => embedding.embedQuery(text),
          embedDocuments: async (texts) => texts.map(() => invalid),
        }
        const f = await fixture(port)
        await expect(f.retrieval.index(f.owner, f.snapshot.id, f.entries)).rejects.toThrow(
          'retrieval embedding',
        )
        expect(await f.retrieval.isLive(f.owner, f.snapshot.id)).toBe(false)
      }
    })

    test('deletion wins while embedding is in flight; stale publication cannot resurrect bytes', async () => {
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const port: EmbeddingPort = {
        profile: embedding.profile,
        embedQuery: (text) => embedding.embedQuery(text),
        embedDocuments: async (texts) => {
          started.resolve()
          await release.promise
          return embedding.embedDocuments(texts)
        },
      }
      const f = await fixture(port)
      const indexing = f.retrieval.index(f.owner, f.snapshot.id, f.entries)
      await started.promise
      await f.retrieval.markDeleted(f.owner, f.snapshot.id, 'race', new Date().toISOString())
      release.resolve()
      await expect(indexing).rejects.toThrow('deleted')
      for (const strategy of ['lexical', 'dense', 'hybrid'] as const)
        expect(await f.retrieval.search(f.owner, f.snapshot.id, 'lease', 2, { strategy })).toEqual(
          [],
        )
    })
  },
)
