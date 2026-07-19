import { createHash } from 'node:crypto'
import { SessionLog, linkArtifactsToClaim, replay } from '@closer/core'
import type { Evidence } from '@closer/contracts'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import { ingestIsolated } from '../parse/isolated.ts'
import type { HandlerContext } from './context.ts'
import type { JobRecord } from '@closer/contracts'

export async function ingestRepository(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'ingest_repository') throw new Error('wrong payload for ingest')
  const { repoPath, ref, sessionId } = job.payload

  const result = await ingestIsolated(repoPath, ref, {
    maxFiles: context.config.INGEST_MAX_FILES,
    maxTotalBytes: context.config.INGEST_MAX_TOTAL_BYTES,
    maxFileBytes: context.config.INGEST_MAX_FILE_BYTES,
    maxDepth: context.config.INGEST_MAX_DEPTH,
    timeoutMs: context.config.INGEST_TIMEOUT_MS,
    heapMb: context.config.INGEST_HEAP_MB,
  })

  const store = context.storeFor(job.ownerId)
  const claimSet = replay(await store.read(CLAIM_SET_SESSION))
  const evidence: Evidence[] = [...claimSet.claims.values()]
    .filter((claim) => claimSet.confirmedClaimIds.has(claim.id))
    .flatMap((claim) => linkArtifactsToClaim(result.artifacts, claim, context.ids))

  const log = await SessionLog.open({ store, clock: context.clock, ids: context.ids }, sessionId)
  await log.append('state_change', {
    change: 'snapshot_pinned',
    snapshot: result.snapshot,
    artifacts: result.artifacts,
    evidence,
  })

  const contentHash = createHash('sha256')
    .update(
      Object.keys(result.bodies)
        .sort()
        .map((id) => `${id}:${result.bodies[id]}`)
        .join('\n'),
    )
    .digest('hex')

  await context.retrieval.recordSnapshot(job.ownerId, result.snapshot, contentHash)
  await context.retrieval.index(
    job.ownerId,
    result.snapshot.id,
    result.artifacts
      .map((artifact) => ({ artifact, text: result.bodies[artifact.id] ?? '' }))
      .filter((entry) => entry.text !== ''),
  )

  context.logger.log('info', 'repository ingested', {
    jobId: job.id,
    ownerId: job.ownerId,
    snapshotId: result.snapshot.id,
    files: result.snapshot.fileCount,
    artifacts: result.artifacts.length,
    evidenceLinks: evidence.length,
  })
}
