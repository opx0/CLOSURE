import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { planNextSession, replay } from '@closer/core'
import type { GapEntry, JobRecord } from '@closer/contracts'
import type { HandlerContext } from './context.ts'

export async function planRetrieval(job: JobRecord, context: HandlerContext): Promise<void> {
  if (job.payload.kind !== 'plan_retrieval') throw new Error('wrong payload for retrieval plan')

  const store = context.storeFor(job.ownerId)
  const gaps = new Map<string, GapEntry>()
  for (const sessionId of await store.listSessions()) {
    for (const gap of replay(await store.read(sessionId)).gaps.values()) {
      const known = gaps.get(gap.id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(gap.id, gap)
    }
  }

  const plan = planNextSession({
    gaps: [...gaps.values()],
    now: context.clock.now(),
    horizonDays: job.payload.horizonDays,
    retrievalLimit: 3,
  })

  const directory = join(context.config.CLOSER_EVENT_DIR, '..', 'plans')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, `${job.ownerId}.json`),
    `${JSON.stringify(plan, null, 2)}\n`,
    'utf8',
  )

  context.logger.log('info', 'retrieval plan written', {
    jobId: job.id,
    ownerId: job.ownerId,
    due: plan.work.length,
    retrievals: plan.retrievals.length,
  })
}
