import { join } from 'node:path'
import type { JobRecord } from '@levelhead/contracts'
import { FileNudgeLedger } from '../adapters/nudge-ledger.ts'
import type { HandlerContext } from './context.ts'

// Boundary wiring only. What a nudge says and whether it should exist at all were decided in core
// before this job was enqueued; this picks the adapter, calls it once, and records what came back.
//
// Nothing here logs the subject, the body or the recipient. A nudge quotes the candidate's own
// gaps back at them, which makes it exactly the kind of text the export and deletion promise says
// never lands in a log line.
export async function sendNudge(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'send_nudge') throw new Error('wrong payload for nudge')
  const { nudge, dryRun } = job.payload

  const ledger = new FileNudgeLedger(join(context.config.LEVELHEAD_EVENT_DIR, '..', 'nudges'))
  const at = context.clock.now()
  const claim = await ledger.claim(job.ownerId, job.idempotencyKey, nudge, at)

  if (claim.state === 'taken') {
    // At most once, on purpose. A nudge the candidate receives twice is worse than one they never
    // receive, so an attempt that was interrupted mid-flight is reported and abandoned rather than
    // repeated, and the job succeeds having changed nothing.
    context.logger.log(
      claim.attempt.delivery === null ? 'warn' : 'info',
      'nudge already attempted under this key; not sending again',
      {
        jobId: job.id,
        ownerId: job.ownerId,
        channel: nudge.channel,
        outcome: claim.attempt.delivery?.outcome ?? 'interrupted',
      },
    )
    return
  }

  const choice = context.outreach.choose(nudge.channel, dryRun)
  const delivery = await choice.port.send(nudge)

  await ledger.resolve(job.ownerId, job.idempotencyKey, {
    nudgeId: nudge.id,
    attemptedAt: at,
    delivery,
    rendered: delivery.outcome === 'dry_run' ? { subject: nudge.subject, body: nudge.body } : null,
  })

  // The rejection's detail stays in the owner's ledger file rather than the log, because a provider
  // is free to quote the message back inside its own error text.
  context.logger.log(
    delivery.outcome === 'rejected_by_provider' ? 'warn' : 'info',
    'nudge handled',
    {
      jobId: job.id,
      ownerId: job.ownerId,
      channel: nudge.channel,
      provider: choice.provider,
      selection: choice.reason,
      outcome: delivery.outcome,
      gaps: nudge.gapIds.length,
    },
  )
}
