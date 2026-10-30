import type {
  Ceilings,
  Clock,
  ConductorPort,
  EvaluatorPort,
  EventStore,
  IdSource,
  JobQueuePort,
  Logger,
  RetrievalPort,
} from '@levelhead/core'
import type { OwnerId, Principal } from '@levelhead/contracts'

// Built once at the edge and handed down — a route reaching for `process.env` itself would be a
// second composition root, drifting from this one the first time they disagreed about a ceiling.
export interface ServerDeps {
  // Every store handed to a route is already scoped to one owner, so a route cannot forget to
  // filter (ADR-023).
  storeFor(owner: OwnerId | Principal): EventStore
  sourceRelocation?: { from: string; to: string }
  clock: Clock
  ids: IdSource
  conductor: ConductorPort
  evaluator: EvaluatorPort
  ceilings: Ceilings
  logger: Logger
  // Present only where a durable queue and a retrieval index exist; the file-backed local setup has
  // neither, and a route that needs one says so rather than pretending.
  queue: JobQueuePort | null
  retrieval: RetrievalPort | null
}

export function ownerOf(owner: OwnerId | Principal): OwnerId {
  return typeof owner === 'string' ? owner : owner.ownerId
}
