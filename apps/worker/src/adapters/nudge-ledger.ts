import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Nudge, NudgeDelivery, OwnerId } from '@levelhead/contracts'

export interface NudgeAttempt {
  nudgeId: string
  attemptedAt: string
  delivery: NudgeDelivery | null
  // Written only for a dry run. "Renders every message in full and delivers none" has to land
  // somewhere a person can read it, and the log is the one place a message quoting the candidate's
  // own gaps may not go.
  rendered: { subject: string | null; body: string } | null
}

export type NudgeClaim = { state: 'claimed' } | { state: 'taken'; attempt: NudgeAttempt }

export class FileNudgeLedger {
  constructor(private readonly directory: string) {}

  // Exclusive create is the whole mechanism. The first caller to land the file owns the send; a
  // retry after a crash, or a second worker that picked up an expired lease, reads the file back
  // instead of sending a second copy to a person.
  async claim(ownerId: OwnerId, key: string, nudge: Nudge, at: string): Promise<NudgeClaim> {
    const path = this.#pathFor(ownerId, key)
    await mkdir(dirname(path), { recursive: true })
    const fresh: NudgeAttempt = {
      nudgeId: nudge.id,
      attemptedAt: at,
      delivery: null,
      rendered: null,
    }

    try {
      await writeFile(path, `${JSON.stringify(fresh, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      })
      return { state: 'claimed' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return { state: 'taken', attempt: JSON.parse(await readFile(path, 'utf8')) as NudgeAttempt }
    }
  }

  async resolve(ownerId: OwnerId, key: string, attempt: NudgeAttempt): Promise<void> {
    await writeFile(this.#pathFor(ownerId, key), `${JSON.stringify(attempt, null, 2)}\n`, 'utf8')
  }

  // The idempotency key is caller-supplied text; hashing it keeps it out of the filesystem's naming
  // rules entirely, and the hash is stable so the same key always finds the same claim.
  #pathFor(ownerId: OwnerId, key: string): string {
    return join(this.directory, ownerId, `${createHash('sha256').update(key).digest('hex')}.json`)
  }
}
