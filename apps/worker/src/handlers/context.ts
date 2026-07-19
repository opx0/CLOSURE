import type { Clock, EventStore, IdSource, JobQueuePort, Logger } from '@closer/core'
import type { OwnerId } from '@closer/contracts'
import type { PostgresRetrieval } from '@closer/db'
import type { WorkerConfig } from '../config.ts'

export interface HandlerContext {
  config: WorkerConfig
  storeFor(ownerId: OwnerId): EventStore
  retrieval: PostgresRetrieval
  queue: JobQueuePort
  logger: Logger
  clock: Clock
  ids: IdSource
}
