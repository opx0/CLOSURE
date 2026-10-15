import { sql, type SQL } from 'drizzle-orm'
import { LOCAL_OWNER_ID, type Artifact, type OwnerId, type Snapshot } from '@levelhead/contracts'
import type { IndexedArtifact, RetrievalHit, RetrievalPort } from '@levelhead/core'
import { artifactIndex, snapshots } from './schema.ts'
import { toQuery } from './postgres-event-store.ts'
import type { SqlExecutor } from './sql.ts'

const EXCERPT_OPTIONS = 'MaxWords=40, MinWords=12, ShortWord=3, MaxFragments=2'

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
      artifact_id, snapshot_id, kind, path, symbol, start_line, end_line,
      ts_rank_cd(search, websearch_to_tsquery('english', ${query}::text)) as rank,
      ts_headline('english', body, websearch_to_tsquery('english', ${query}::text),
        ${EXCERPT_OPTIONS}) as excerpt
    from ${artifactIndex}
    where owner_id = ${ownerId}::text
      and snapshot_id = ${snapshotId}::text
      and search @@ websearch_to_tsquery('english', ${query}::text)
    order by rank desc, path asc
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
    on conflict (id) do update set content_hash = excluded.content_hash
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

export class PostgresRetrieval implements RetrievalPort {
  readonly #sql: SqlExecutor

  constructor(executor: SqlExecutor) {
    this.#sql = executor
  }

  async index(
    ownerId: OwnerId,
    snapshotId: string,
    entries: readonly IndexedArtifact[],
  ): Promise<void> {
    for (const entry of entries) {
      const { sql: text, params } = toQuery(upsertArtifactStatement(ownerId, snapshotId, entry))
      await this.#sql.query(text, params)
    }
  }

  async search(
    ownerId: OwnerId,
    snapshotId: string,
    query: string,
    limit: number,
  ): Promise<RetrievalHit[]> {
    const { sql: text, params } = toQuery(searchStatement(ownerId, snapshotId, query, limit))
    const { rows } = await this.#sql.query(text, params)
    return rows.map((row) => ({
      artifact: rowToArtifact(row),
      rank: Number(row['rank']),
      excerpt: String(row['excerpt'] ?? ''),
    }))
  }

  async forget(ownerId: OwnerId, snapshotId: string): Promise<void> {
    const { sql: text, params } = toQuery(forgetStatement(ownerId, snapshotId))
    await this.#sql.query(text, params)
  }

  async recordSnapshot(ownerId: OwnerId, snapshot: Snapshot, contentHash: string): Promise<void> {
    const { sql: text, params } = toQuery(recordSnapshotStatement(ownerId, snapshot, contentHash))
    await this.#sql.query(text, params)
  }

  async markDeleted(
    ownerId: OwnerId,
    snapshotId: string,
    reason: string,
    deletedAt: string,
  ): Promise<void> {
    const { sql: text, params } = toQuery(
      markSnapshotDeletedStatement(ownerId, snapshotId, reason, deletedAt),
    )
    await this.#sql.query(text, params)
    await this.forget(ownerId, snapshotId)
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
}
