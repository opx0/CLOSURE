import type { JobKind, JobPayload, JobRecord, OwnerId } from '@closer/contracts'

export interface EnqueueInput {
  ownerId: OwnerId
  kind: JobKind
  payload: JobPayload
  idempotencyKey: string
  runAfter?: string
  maxAttempts?: number
}

export interface ClaimInput {
  leaseOwner: string
  leaseSeconds: number
  kinds?: readonly JobKind[]
  limit?: number
}

export interface JobQueuePort {
  enqueue(input: EnqueueInput): Promise<JobRecord>
  claim(input: ClaimInput): Promise<JobRecord[]>
  succeed(jobId: string, leaseOwner: string): Promise<void>
  retry(jobId: string, leaseOwner: string, error: string, runAfter: string): Promise<void>
  bury(jobId: string, leaseOwner: string, error: string): Promise<void>
  release(jobId: string, leaseOwner: string): Promise<void>
  list(ownerId: OwnerId, limit: number): Promise<JobRecord[]>
  get(jobId: string): Promise<JobRecord | null>
}

export function backoffMs(attempt: number, baseMs = 1_000, capMs = 300_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
  const jitter = exponential * 0.25
  return Math.round(exponential - jitter + Math.random() * 2 * jitter)
}
