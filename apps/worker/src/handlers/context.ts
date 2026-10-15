import type { Clock, EventStore, IdSource, JobQueuePort, Logger } from '@levelhead/core'
import type { OwnerId } from '@levelhead/contracts'
import type { PostgresRetrieval } from '@levelhead/db'
import type { OutreachAdapters } from '../adapters/outreach.ts'
import type { WorkerConfig } from '../config.ts'

export interface HandlerContext {
  config: WorkerConfig
  storeFor(ownerId: OwnerId): EventStore
  retrieval: PostgresRetrieval
  queue: JobQueuePort
  outreach: OutreachAdapters
  logger: Logger
  clock: Clock
  ids: IdSource
}
