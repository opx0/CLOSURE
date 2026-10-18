import { SessionLog, linkSnapshotToClaims, pinnedSnapshots, replay } from '@levelhead/core'
import type { Clock, EventStore, IdSource } from '@levelhead/core'
import type { Artifact, Evidence } from '@levelhead/contracts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { INGEST_DEFAULTS, type IngestConfig } from '../config.ts'
import { ingestIsolated, type IngestLimits, type IngestResult } from '../parse/isolated.ts'
import type { HandlerContext } from './context.ts'
import type { JobRecord } from '@levelhead/contracts'
import { GitRepository } from '../../../cli/src/repo/git-repository.ts'
import { indexRepository } from '../../../cli/src/repository-search.ts'

export function ingestLimits(config: IngestConfig): IngestLimits {
  return {
    maxFiles: config.INGEST_MAX_FILES,
    maxTotalBytes: config.INGEST_MAX_TOTAL_BYTES,
    maxFileBytes: config.INGEST_MAX_FILE_BYTES,
    maxDepth: config.INGEST_MAX_DEPTH,
    timeoutMs: config.INGEST_TIMEOUT_MS,
    heapMb: config.INGEST_HEAP_MB,
  }
}

export const DEFAULT_INGEST_LIMITS = ingestLimits(INGEST_DEFAULTS)

export interface PinRequest {
  repoPath: string
  ref: string
  sessionId: string
}

export interface Pinned extends IngestResult {
  evidence: Evidence[]
}

function linkKeys(artifacts: readonly Artifact[], evidence: readonly Evidence[]): string {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  return evidence
    .flatMap((link) => {
      if (link.subject.kind !== 'claim' || link.target.kind !== 'artifact') return []
      const artifact = byId.get(link.target.artifactId)
      if (artifact === undefined) return []
      const at = `${artifact.path}#${artifact.symbol ?? ''}:${artifact.startLine ?? ''}`
      return [`${link.subject.claimId} ${at}`]
    })
    .sort()
    .join('\n')
}

// Shared with a server that has no queue to hand the job to. `reuseIdentical` returns an existing
// pin of the same commit instead of listing the same project twice; a pin whose claim links have
// changed since is a new pin. The worker leaves it off, because it also indexes what it pins.
export async function pinIsolated(
  deps: { store: EventStore; clock: Clock; ids: IdSource },
  request: PinRequest,
  limits: IngestLimits,
  options: { reuseIdentical?: boolean; publish?: boolean } = {},
): Promise<Pinned> {
  const result = await ingestIsolated(request.repoPath, request.ref, limits)

  const claimSet = replay(await deps.store.read(CLAIM_SET_SESSION))
  const confirmed = [...claimSet.claims.values()].filter((claim) =>
    claimSet.confirmedClaimIds.has(claim.id),
  )
  const evidence = linkSnapshotToClaims(result.artifacts, confirmed, deps.ids)

  if (options.reuseIdentical === true) {
    const links = linkKeys(result.artifacts, evidence)
    const same = pinnedSnapshots(await deps.store.read(request.sessionId)).find(
      (entry) =>
        !entry.deleted &&
        entry.snapshot.repoPath === result.snapshot.repoPath &&
        entry.snapshot.commit === result.snapshot.commit &&
        linkKeys(entry.artifacts, entry.evidence) === links,
    )
    if (same !== undefined) {
      const repository = new GitRepository({ ids: deps.ids, clock: deps.clock })
      repository.register(same.snapshot)
      const bodies: Record<string, string> = {}
      for (const artifact of same.artifacts) {
        const text = await repository.read(artifact)
        if (text === null) throw new Error('reused ingestion pin is no longer readable')
        bodies[artifact.id] = text
      }
      return {
        ...result,
        bodies,
        snapshot: same.snapshot,
        artifacts: same.artifacts,
        evidence: same.evidence,
      }
    }
  }

  if (options.publish !== false) {
    const log = await SessionLog.open(deps, request.sessionId)
    await log.append('state_change', {
      change: 'snapshot_pinned',
      snapshot: result.snapshot,
      artifacts: result.artifacts,
      evidence,
    })
  }
  return { ...result, evidence }
}

export async function ingestRepository(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'ingest_repository') throw new Error('wrong payload for ingest')
  const { repoPath, ref, sessionId } = job.payload

  const store = context.storeFor(job.ownerId)
  const deps = { store, clock: context.clock, ids: context.ids }
  // A durable per-job pin is the checkpoint, not HEAD. A retry after a committed pin can only
  // rehydrate that commit with the same artifact ids, even if the branch has moved meanwhile.
  const checkpoint = `ingest-${job.id}`
  const saved = pinnedSnapshots(await store.read(checkpoint))[0]
  let result: Pinned
  if (saved === undefined) {
    result = await pinIsolated(
      deps,
      { repoPath, ref, sessionId: checkpoint },
      ingestLimits(context.config),
    )
  } else {
    const repository = new GitRepository({ ids: context.ids, clock: context.clock })
    repository.register(saved.snapshot)
    const bodies: Record<string, string> = {}
    for (const artifact of saved.artifacts) {
      const text = await repository.read(artifact)
      if (text === null) throw new Error('committed ingestion pin is no longer readable')
      bodies[artifact.id] = text
    }
    result = {
      snapshot: saved.snapshot,
      artifacts: saved.artifacts,
      evidence: saved.evidence,
      bodies,
    }
  }
  const existing = pinnedSnapshots(await store.read(sessionId)).find(
    (entry) => entry.snapshot.id === result.snapshot.id,
  )
  if (existing?.deleted === true) throw new Error('ingestion pin was deleted')
  await indexRepository(
    context.retrieval,
    job.ownerId,
    result.snapshot,
    result.artifacts.map((artifact) => ({ artifact, text: result.bodies[artifact.id] ?? '' })),
  )
  if (existing === undefined) {
    const log = await SessionLog.open(deps, sessionId)
    await log.append('state_change', {
      change: 'snapshot_pinned',
      snapshot: result.snapshot,
      artifacts: result.artifacts,
      evidence: result.evidence,
    })
  }

  context.logger.log('info', 'repository ingested', {
    jobId: job.id,
    ownerId: job.ownerId,
    snapshotId: result.snapshot.id,
    files: result.snapshot.fileCount,
    artifacts: result.artifacts.length,
    evidenceLinks: result.evidence.length,
  })
}
