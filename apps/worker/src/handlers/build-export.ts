import { join } from 'node:path'
import { buildExportBundle } from '@levelhead/core'
import { LocalObjectStore } from '../../../cli/src/store/objects.ts'
import type { JobRecord } from '@levelhead/contracts'
import type { HandlerContext } from './context.ts'

export async function buildExport(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'build_export') throw new Error('wrong payload for export')

  const store = context.storeFor(job.ownerId)
  const sessionIds = await store.listSessions()
  const sessions = []
  for (const sessionId of sessionIds) {
    sessions.push({ sessionId, events: await store.read(sessionId) })
  }

  const bundle = buildExportBundle({
    ownerId: job.ownerId,
    producedAt: context.clock.now(),
    sessions,
  })

  // Through the object-store port (ADR-017): the local filesystem here, an S3-compatible bucket
  // wherever this is deployed, with no change above this line.
  const objects = new LocalObjectStore(context.config.LEVELHEAD_EXPORT_DIR)
  const key = `${job.ownerId}/${job.payload.destination}.json`
  const written = await objects.put(key, `${JSON.stringify(bundle, null, 2)}\n`)

  context.logger.log('info', 'export written', {
    jobId: job.id,
    ownerId: job.ownerId,
    sessions: bundle.sessions.length,
    file: join(context.config.LEVELHEAD_EXPORT_DIR, key),
    bytes: written.bytes,
    contentHash: written.contentHash,
  })
}
