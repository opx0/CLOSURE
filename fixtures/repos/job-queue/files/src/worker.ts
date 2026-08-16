import { claimJob, completeJob } from './queue.ts'

export async function runWorker(db: Db, handle: (job: Job) => Promise<void>): Promise<void> {
  for (;;) {
    const job = await claimJob(db)
    if (job === null) {
      await sleep(500)
      continue
    }
    await handle(job)
    await completeJob(db, job.id)
  }
}
