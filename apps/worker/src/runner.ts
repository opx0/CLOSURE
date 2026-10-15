import { backoffMs, type JobQueuePort, type Logger } from '@levelhead/core'
import { JOB_ATTEMPTS, JOB_DURATION, metrics } from '@levelhead/observability'
import type { JobKind, JobRecord } from '@levelhead/contracts'
import { HANDLERS, type HandlerContext } from './handlers/index.ts'

export interface RunnerOptions {
  name: string
  pollMs: number
  leaseSeconds: number
  batch: number
  kinds?: readonly JobKind[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export class JobRunner {
  #stopping = false
  #inFlight = new Set<string>()

  constructor(
    private readonly queue: JobQueuePort,
    private readonly context: HandlerContext,
    private readonly options: RunnerOptions,
    private readonly logger: Logger,
  ) {}

  get busy(): boolean {
    return this.#inFlight.size > 0
  }

  async runOnce(): Promise<number> {
    const claimed = await this.queue.claim({
      leaseOwner: this.options.name,
      leaseSeconds: this.options.leaseSeconds,
      limit: this.options.batch,
      ...(this.options.kinds === undefined ? {} : { kinds: this.options.kinds }),
    })

    for (const job of claimed) await this.#run(job)
    return claimed.length
  }

  async loop(): Promise<void> {
    while (!this.#stopping) {
      let handled = 0
      try {
        handled = await this.runOnce()
      } catch (error) {
        this.logger.log('error', 'claim failed', { error: messageOf(error) })
      }
      if (handled === 0 && !this.#stopping) await this.#sleep(this.options.pollMs)
    }
  }

  // Graceful shutdown: stop claiming, let what is in flight finish, and hand back anything that
  // cannot. A killed worker's lease expires anyway, but a returned row is picked up immediately.
  async stop(): Promise<void> {
    this.#stopping = true
    const deadline = Date.now() + this.options.leaseSeconds * 1_000
    while (this.busy && Date.now() < deadline) await this.#sleep(50)
    for (const jobId of this.#inFlight) {
      await this.queue.release(jobId, this.options.name).catch(() => {})
    }
  }

  async #run(job: JobRecord): Promise<void> {
    this.#inFlight.add(job.id)
    const startedAt = Date.now()
    const logger = this.logger.child({ jobId: job.id, kind: job.kind, ownerId: job.ownerId })
    metrics.counter(JOB_ATTEMPTS, 'Job attempts by kind and outcome', {
      kind: job.kind,
      outcome: 'started',
    })

    try {
      const handler = HANDLERS[job.kind]
      await handler(job, this.context)
      await this.queue.succeed(job.id, this.options.name)
      metrics.counter(JOB_ATTEMPTS, 'Job attempts by kind and outcome', {
        kind: job.kind,
        outcome: 'succeeded',
      })
      logger.log('info', 'job succeeded', { attempts: job.attempts })
    } catch (error) {
      const message = messageOf(error)
      const terminal = job.attempts >= job.maxAttempts
      if (terminal) {
        await this.queue.bury(job.id, this.options.name, message)
      } else {
        const runAfter = new Date(Date.now() + backoffMs(job.attempts)).toISOString()
        await this.queue.retry(job.id, this.options.name, message, runAfter)
      }
      metrics.counter(JOB_ATTEMPTS, 'Job attempts by kind and outcome', {
        kind: job.kind,
        outcome: terminal ? 'dead' : 'retried',
      })
      logger.log(terminal ? 'error' : 'warn', 'job failed', {
        attempts: job.attempts,
        terminal,
        error: message,
      })
    } finally {
      this.#inFlight.delete(job.id)
      metrics.observe(JOB_DURATION, 'Job duration in seconds', (Date.now() - startedAt) / 1_000, {
        kind: job.kind,
      })
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
