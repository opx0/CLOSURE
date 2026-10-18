import { sql, type SQL } from 'drizzle-orm'
import { LOCAL_OWNER_ID, type Artifact, type OwnerId, type Snapshot } from '@levelhead/contracts'
import {
  chunkArtifact,
  reciprocalRankFusion,
  type EmbeddingPort,
  type EmbeddingProfile,
  type IndexedArtifact,
  type RetrievalHit,
  type RetrievalPort,
  type RetrievalSearchOptions,
} from '@levelhead/core'
import { artifactIndex, snapshots } from './schema.ts'
import { toQuery } from './postgres-event-store.ts'
import type { SqlExecutor, SqlPool } from './sql.ts'

// camelCase, snake_case, SCREAMING_CASE and dotted paths all become the same word stream, so a
// query in prose can reach an identifier and an identifier can reach a query in prose.
export function splitIdentifiers(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
}

export function upsertArtifactStatement(
  ownerId: OwnerId,
  snapshotId: string,
  entry: IndexedArtifact,
): SQL {
  const { artifact } = entry
  return sql`
    insert into ${artifactIndex} (
      artifact_id, snapshot_id, owner_id, kind, path, symbol, start_line, end_line, body, tokens
    )
    values (
      ${artifact.id}::text,
      ${snapshotId}::text,
      ${ownerId}::text,
      ${artifact.kind}::text,
      ${artifact.path}::text,
      ${artifact.symbol ?? null}::text,
      ${artifact.startLine ?? null}::integer,
      ${artifact.endLine ?? null}::integer,
      ${entry.text}::text,
      ${splitIdentifiers(`${artifact.path} ${artifact.symbol ?? ''} ${entry.text}`)}::text
    )
    on conflict (artifact_id) do update
      set body = excluded.body,
          tokens = excluded.tokens,
          path = excluded.path,
          symbol = excluded.symbol,
          start_line = excluded.start_line,
           end_line = excluded.end_line
      where artifact_index.owner_id = excluded.owner_id
        and artifact_index.snapshot_id = excluded.snapshot_id
    returning artifact_id
  `
}

// websearch_to_tsquery, not plain_to_tsquery: a claim's words arrive as ordinary prose, and a bare
// apostrophe or operator in candidate text must never become part of the query language.
export function searchStatement(
  ownerId: OwnerId,
  snapshotId: string,
  rawQuery: string,
  limit: number,
): SQL {
  // The query is split the same way the body was, so `claimJob` and "claim job" reach each other.
  const query = splitIdentifiers(rawQuery)
  return sql`
    select
      a.artifact_id, c.snapshot_id, a.kind, a.path, a.symbol,
      a.start_line, a.end_line, c.start_line as chunk_start_line, c.end_line as chunk_end_line, c.id as chunk_id, c.content_hash,
      ts_rank_cd(c.search, websearch_to_tsquery('english', ${query}::text)) as rank,
      c.body as excerpt
    from retrieval_chunks c
    join artifact_index a on a.artifact_id = c.artifact_id and a.owner_id = c.owner_id
    join snapshots s on s.id = c.snapshot_id and s.owner_id = c.owner_id
    join retrieval_publications p on p.snapshot_id = c.snapshot_id and p.owner_id = c.owner_id
    where c.owner_id = ${ownerId}::text
      and c.snapshot_id = ${snapshotId}::text and s.deleted_at is null
      and c.search @@ websearch_to_tsquery('english', ${query}::text)
    order by rank desc, a.path asc, c.start_line asc, c.id asc
    limit ${limit}::integer
  `
}

export function forgetStatement(ownerId: OwnerId, snapshotId: string): SQL {
  return sql`
    delete from ${artifactIndex}
    where owner_id = ${ownerId}::text and snapshot_id = ${snapshotId}::text
  `
}

export function recordSnapshotStatement(
  ownerId: OwnerId,
  snapshot: Snapshot,
  contentHash: string,
): SQL {
  return sql`
    insert into ${snapshots} (
      id, owner_id, repo_path, commit_sha, file_count, content_hash, pinned_at
    )
    values (
      ${snapshot.id}::text,
      ${ownerId}::text,
      ${snapshot.repoPath}::text,
      ${snapshot.commit}::text,
      ${snapshot.fileCount}::integer,
      ${contentHash}::text,
      ${snapshot.pinnedAt}::timestamptz
    )
    on conflict (id) do nothing
  `
}

export function markSnapshotDeletedStatement(
  ownerId: OwnerId,
  snapshotId: string,
  reason: string,
  deletedAt: string,
): SQL {
  return sql`
    update ${snapshots}
    set deleted_at = ${deletedAt}::timestamptz, deleted_reason = ${reason}::text
    where id = ${snapshotId}::text and owner_id = ${ownerId}::text and deleted_at is null
  `
}

export function liveSnapshotsStatement(ownerId: OwnerId): SQL {
  return sql`
    select
      id, repo_path, commit_sha, file_count, content_hash,
      to_char(pinned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as pinned_at
    from ${snapshots}
    where owner_id = ${ownerId}::text and deleted_at is null
    order by pinned_at desc
  `
}

function rowToArtifact(row: Record<string, unknown>): Artifact {
  const symbol = row['symbol']
  const startLine = row['start_line']
  const endLine = row['end_line']
  return {
    id: String(row['artifact_id']),
    snapshotId: String(row['snapshot_id']),
    kind: String(row['kind']) as Artifact['kind'],
    path: String(row['path']),
    ...(symbol === null || symbol === undefined ? {} : { symbol: String(symbol) }),
    ...(startLine === null || startLine === undefined ? {} : { startLine: Number(startLine) }),
    ...(endLine === null || endLine === undefined ? {} : { endLine: Number(endLine) }),
  }
}

export interface SnapshotRecord {
  snapshot: Snapshot
  contentHash: string
}

export interface PostgresRetrievalOptions {
  embedding?: EmbeddingPort
  chunkMaxTokens?: number
  chunkOverlapTokens?: number
}

// pgvector stores float32; tolerate its rounding, but never accept a different encoding space.
export function validateRetrievalVector(
  vector: readonly number[],
  profile: EmbeddingProfile,
): void {
  if (vector.length !== profile.dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('retrieval embedding has nonfinite values or wrong dimensions')
  }
  const norm = Math.hypot(...vector)
  if (norm === 0 || Math.abs(norm - 1) >= 0.001) {
    throw new Error('retrieval embedding must be nonzero and L2 normalized')
  }
}

function rowToHit(row: Record<string, unknown>): RetrievalHit {
  return {
    artifact: rowToArtifact(row),
    rank: Number(row['rank']),
    excerpt: String(row['excerpt'] ?? ''),
    chunk: {
      id: String(row['chunk_id']),
      startLine: Number(row['chunk_start_line']),
      endLine: Number(row['chunk_end_line']),
      contentHash: String(row['content_hash']),
    },
  }
}

export class PostgresRetrieval implements RetrievalPort {
  readonly #sql: SqlExecutor
  readonly #options: PostgresRetrievalOptions

  constructor(executor: SqlExecutor, options: PostgresRetrievalOptions = {}) {
    this.#sql = executor
    this.#options = options
  }

  async #transaction<T>(work: (client: SqlExecutor) => Promise<T>): Promise<T> {
    // A pool must be held for the entire transaction. An executor without connect is a dedicated
    // client (also permits statement-level test doubles), never a pool.query wrapper.
    const client = 'connect' in this.#sql ? await (this.#sql as SqlPool).connect() : this.#sql
    try {
      await client.query('BEGIN')
      try {
        const result = await work(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    } finally {
      if ('release' in client && typeof client.release === 'function') client.release()
    }
  }

  async #statement(client: SqlExecutor, statement: SQL) {
    const { sql: text, params } = toQuery(statement)
    return client.query(text, params)
  }

  async #lock(client: SqlExecutor, ownerId: OwnerId, snapshotId: string) {
    const { rows } = await client.query(
      'select owner_id, deleted_at from snapshots where id = $1 for update',
      [snapshotId],
    )
    const row = rows[0]
    if (!row || row['owner_id'] !== ownerId)
      throw new Error('retrieval snapshot missing or owner mismatch')
    return row
  }

  async #profile(client: SqlExecutor, profile: EmbeddingProfile): Promise<void> {
    if (
      !Number.isInteger(profile.dimensions) ||
      profile.dimensions < 1 ||
      profile.normalization !== 'l2'
    ) {
      throw new Error('unsupported retrieval embedding profile')
    }
    await client.query(
      'insert into retrieval_profiles(id, dimensions, profile) values ($1,$2,$3::jsonb) on conflict do nothing',
      [profile.id, profile.dimensions, JSON.stringify(profile)],
    )
    const { rows } = await client.query(
      'select id from retrieval_profiles where id = $1 and dimensions = $2 and profile = $3::jsonb',
      [profile.id, profile.dimensions, JSON.stringify(profile)],
    )
    if (rows.length !== 1)
      throw new Error('retrieval embedding profile collision: immutable encoding contract changed')
  }

  async index(
    ownerId: OwnerId,
    snapshotId: string,
    entries: readonly IndexedArtifact[],
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.artifact.snapshotId !== snapshotId)
        throw new Error('retrieval artifact snapshot mismatch')
    }
    const chunks = entries.flatMap((entry) =>
      chunkArtifact(entry, {
        maxTokens: this.#options.chunkMaxTokens ?? 256,
        overlapTokens: this.#options.chunkOverlapTokens ?? 0,
      }),
    )
    // No network/model work while holding a row lock. Deletion can win while embedding runs;
    // the subsequent lock rechecks the tombstone before publishing any content.
    const embedding = this.#options.embedding
    const profile = embedding ? structuredClone(embedding.profile) : undefined
    const { rows: live } = await this.#sql.query(
      'select id from snapshots where id=$1 and owner_id=$2 and deleted_at is null',
      [snapshotId, ownerId],
    )
    if (live.length !== 1) throw new Error('retrieval snapshot missing, deleted or owner mismatch')
    let vectors: (readonly number[])[] | undefined
    if (embedding && profile) {
      // Stable content/location chunk IDs exclude artifact/snapshot IDs. Reuse only the exact
      // immutable recipe and owner; cache copies remain deletable with their own snapshot.
      const { rows: cached } = await this.#sql.query(
        `select distinct on (c.id) c.id, v.embedding::text as embedding
        from retrieval_vectors v join retrieval_chunks c
          on c.owner_id=v.owner_id and c.snapshot_id=v.snapshot_id and c.id=v.chunk_id
        join snapshots s on s.id=c.snapshot_id and s.owner_id=c.owner_id
        join retrieval_profiles p on p.id=v.profile_id
        where v.owner_id=$1 and v.profile_id=$2 and p.profile=$3::jsonb
          and s.deleted_at is null and c.id=any($4::text[]) order by c.id,c.snapshot_id`,
        [ownerId, profile.id, JSON.stringify(profile), chunks.map((chunk) => chunk.id)],
      )
      const cache = new Map(
        cached.map((row) => [String(row['id']), JSON.parse(String(row['embedding'])) as number[]]),
      )
      const missing = chunks.filter((chunk) => !cache.has(chunk.id))
      const fresh = missing.length
        ? await embedding.embedDocuments(missing.map((chunk) => chunk.text))
        : []
      if (fresh.length !== missing.length)
        throw new Error('retrieval embedding batch length mismatch')
      missing.forEach((chunk, index) => cache.set(chunk.id, [...fresh[index]!]))
      vectors = chunks.map((chunk) => cache.get(chunk.id)!)
    }
    if (vectors && profile) {
      if (vectors.length !== chunks.length)
        throw new Error('retrieval embedding batch length mismatch')
      vectors.forEach((vector) => validateRetrievalVector(vector, profile))
    }
    await this.#transaction(async (client) => {
      const snapshot = await this.#lock(client, ownerId, snapshotId)
      if (snapshot['deleted_at'] !== null) throw new Error('retrieval snapshot is deleted')
      if (profile) await this.#profile(client, profile)
      for (const entry of entries) {
        const result = await this.#statement(
          client,
          upsertArtifactStatement(ownerId, snapshotId, entry),
        )
        if (result.rows.length !== 1) throw new Error('retrieval artifact owner/snapshot collision')
      }
      await client.query(
        'delete from retrieval_publications where owner_id = $1 and snapshot_id = $2',
        [ownerId, snapshotId],
      )
      await client.query('delete from retrieval_chunks where owner_id = $1 and snapshot_id = $2', [
        ownerId,
        snapshotId,
      ])
      // index is a complete snapshot replacement, including removal of no-longer-listed artifacts.
      await client.query(
        'delete from artifact_index where owner_id = $1 and snapshot_id = $2 and not (artifact_id = any($3::text[]))',
        [ownerId, snapshotId, entries.map((entry) => entry.artifact.id)],
      )
      for (const [index, chunk] of chunks.entries()) {
        await client.query(
          `insert into retrieval_chunks(owner_id,snapshot_id,id,artifact_id,start_line,end_line,content_hash,body,tokens)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            ownerId,
            snapshotId,
            chunk.id,
            chunk.artifact.id,
            chunk.startLine,
            chunk.endLine,
            chunk.contentHash,
            chunk.text,
            splitIdentifiers(`${chunk.artifact.path} ${chunk.artifact.symbol ?? ''} ${chunk.text}`),
          ],
        )
        const vector = vectors?.[index]
        if (profile && vector) {
          await client.query(
            'insert into retrieval_vectors(owner_id,snapshot_id,chunk_id,profile_id,embedding) values ($1,$2,$3,$4,$5::public.vector)',
            [ownerId, snapshotId, chunk.id, profile.id, JSON.stringify(vector)],
          )
        }
      }
      await client.query(
        'insert into retrieval_publications(snapshot_id,owner_id,profile_id) values ($1,$2,$3)',
        [snapshotId, ownerId, profile?.id ?? null],
      )
    })
  }

  async search(
    ownerId: OwnerId,
    snapshotId: string,
    query: string,
    limit: number,
    options: RetrievalSearchOptions = {},
  ): Promise<RetrievalHit[]> {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error('retrieval limit must be a positive integer')
    const strategy = options.strategy ?? 'lexical'
    if (!['lexical', 'dense', 'hybrid'].includes(strategy))
      throw new Error('unsupported retrieval strategy')
    if (strategy === 'lexical') {
      const { rows } = await this.#statement(
        this.#sql,
        searchStatement(ownerId, snapshotId, query, limit),
      )
      return rows.map(rowToHit)
    }
    const embedding = this.#options.embedding
    if (!embedding)
      throw new Error('dense/hybrid retrieval unavailable: configure an EmbeddingPort')
    const profile = structuredClone(embedding.profile)
    const vector = await embedding.embedQuery(query)
    validateRetrievalVector(vector, profile)
    // Scope and profile checks execute in the same snapshot as both rankings.
    return this.#transaction(async (client) => {
      const { rows: publications } = await client.query(
        `select p.profile_id, r.profile = $3::jsonb as matches
        from retrieval_publications p join snapshots s on s.id=p.snapshot_id and s.owner_id=p.owner_id
        left join retrieval_profiles r on r.id=p.profile_id
        where p.owner_id=$1 and p.snapshot_id=$2 and s.deleted_at is null for share of s`,
        [ownerId, snapshotId, JSON.stringify(profile)],
      )
      if (publications.length === 0) return []
      if (publications[0]?.['profile_id'] !== profile.id || publications[0]?.['matches'] !== true) {
        throw new Error(
          'dense/hybrid retrieval unavailable: snapshot encoding profile mismatch; reindex required',
        )
      }
      const { rows } = await client.query(
        `select a.artifact_id,c.snapshot_id,a.kind,a.path,a.symbol,
        a.start_line,a.end_line,c.start_line as chunk_start_line,c.end_line as chunk_end_line,c.id as chunk_id,c.content_hash,c.body as excerpt,
        1 - (v.embedding <=> $4::public.vector) as rank
        from retrieval_vectors v join retrieval_chunks c
          on c.owner_id=v.owner_id and c.snapshot_id=v.snapshot_id and c.id=v.chunk_id
        join artifact_index a on a.artifact_id=c.artifact_id and a.owner_id=c.owner_id
        join snapshots s on s.id=c.snapshot_id and s.owner_id=c.owner_id
        join retrieval_publications p on p.snapshot_id=c.snapshot_id and p.owner_id=c.owner_id and p.profile_id=v.profile_id
        where v.owner_id=$1 and v.snapshot_id=$2 and v.profile_id=$3 and s.deleted_at is null
        order by v.embedding <=> $4::public.vector, a.path, c.start_line, c.id limit $5`,
        [ownerId, snapshotId, profile.id, JSON.stringify(vector), limit],
      )
      const dense = rows.map(rowToHit)
      if (strategy === 'dense') return dense
      const lexical = await this.#statement(
        client,
        searchStatement(ownerId, snapshotId, query, limit),
      )
      return reciprocalRankFusion(lexical.rows.map(rowToHit), dense, limit)
    })
  }

  async forget(ownerId: OwnerId, snapshotId: string): Promise<void> {
    await this.markDeleted(ownerId, snapshotId, 'forgotten', new Date().toISOString())
  }

  async recordSnapshot(ownerId: OwnerId, snapshot: Snapshot, contentHash: string): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#statement(client, recordSnapshotStatement(ownerId, snapshot, contentHash))
      const { rows } = await client.query(
        `select id from snapshots where id=$1 and owner_id=$2
        and repo_path=$3 and commit_sha=$4 and file_count=$5 and content_hash=$6
        and pinned_at=$7::timestamptz and deleted_at is null for update`,
        [
          snapshot.id,
          ownerId,
          snapshot.repoPath,
          snapshot.commit,
          snapshot.fileCount,
          contentHash,
          snapshot.pinnedAt,
        ],
      )
      if (rows.length !== 1) throw new Error('retrieval snapshot conflict or tombstone')
    })
  }

  async markDeleted(
    ownerId: OwnerId,
    snapshotId: string,
    reason: string,
    deletedAt: string,
  ): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lock(client, ownerId, snapshotId)
      await this.#statement(
        client,
        markSnapshotDeletedStatement(ownerId, snapshotId, reason, deletedAt),
      )
      await client.query(
        'delete from retrieval_publications where owner_id=$1 and snapshot_id=$2',
        [ownerId, snapshotId],
      )
      await client.query('delete from retrieval_chunks where owner_id=$1 and snapshot_id=$2', [
        ownerId,
        snapshotId,
      ])
      await this.#statement(client, forgetStatement(ownerId, snapshotId))
    })
  }

  async isLive(ownerId: OwnerId, snapshotId: string): Promise<boolean> {
    const { rows } = await this.#sql.query(
      `select s.id from snapshots s
      join retrieval_publications p on p.snapshot_id=s.id and p.owner_id=s.owner_id
      where s.owner_id=$1 and s.id=$2 and s.deleted_at is null`,
      [ownerId, snapshotId],
    )
    return rows.length === 1
  }

  async liveSnapshots(ownerId: OwnerId = LOCAL_OWNER_ID): Promise<SnapshotRecord[]> {
    const { sql: text, params } = toQuery(liveSnapshotsStatement(ownerId))
    const { rows } = await this.#sql.query(text, params)
    return rows.map((row) => ({
      contentHash: String(row['content_hash']),
      snapshot: {
        id: String(row['id']),
        repoPath: String(row['repo_path']),
        commit: String(row['commit_sha']),
        fileCount: Number(row['file_count']),
        pinnedAt: String(row['pinned_at']),
      },
    }))
  }

  async deletedSnapshots(
    ownerId: OwnerId,
  ): Promise<(SnapshotRecord & { reason: string; deletedAt: string })[]> {
    const { rows } = await this.#sql.query(
      `select id, repo_path, commit_sha, file_count, content_hash, deleted_reason,
      to_char(pinned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as pinned_at,
      to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deleted_at
      from snapshots where owner_id=$1 and deleted_at is not null order by deleted_at, id`,
      [ownerId],
    )
    return rows.map((row) => ({
      snapshot: {
        id: String(row['id']),
        repoPath: String(row['repo_path']),
        commit: String(row['commit_sha']),
        fileCount: Number(row['file_count']),
        pinnedAt: String(row['pinned_at']),
      },
      contentHash: String(row['content_hash']),
      reason: String(row['deleted_reason']),
      deletedAt: String(row['deleted_at']),
    }))
  }
}
