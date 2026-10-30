import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LOCAL_OWNER_ID, type AnyEvent, type OwnerId } from '@levelhead/contracts'
import { AppendOnlyViolation, readEvent, type EventStore } from '@levelhead/core'

const DEFAULT_DIR = '.levelhead/events'
const EXTENSION = '.jsonl'
// Internal append-only ledgers such as _stories and _designs share the store and need safe names.
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}

// One file per session, one JSON object per line, opened O_APPEND — mirrors the Postgres `events`
// table (same envelope, unique (session_id, seq), no UPDATE/DELETE), so migrating is just replaying
// files into it; both are an EventStore over the same envelope.
//
// Owner scoping (ADR-023) is the directory: `<dir>/<ownerId>/<session>.jsonl`. The local owner also
// reads the flat `<dir>/<session>.jsonl` layout logs were written in before the boundary landed,
// so an existing log keeps replaying without being rewritten.
export class JsonlEventStore implements EventStore {
  readonly #root: string
  readonly #ownerId: OwnerId

  constructor(dir: string = DEFAULT_DIR, ownerId: OwnerId = LOCAL_OWNER_ID) {
    if (!SAFE_NAME.test(ownerId)) {
      throw new Error(`owner id ${JSON.stringify(ownerId)} is not usable as a directory name`)
    }
    this.#root = dir
    this.#ownerId = ownerId
  }

  get ownerId(): OwnerId {
    return this.#ownerId
  }

  forOwner(ownerId: OwnerId): JsonlEventStore {
    return new JsonlEventStore(this.#root, ownerId)
  }

  async append(event: AnyEvent): Promise<void> {
    const file = await this.#fileFor(event.sessionId)

    // Read off disk, not an in-memory counter — the check exists for events this process didn't write.
    const highest = await this.#highestSeq(file)
    if (event.seq <= highest) throw new AppendOnlyViolation(event.sessionId, event.seq)
    if (event.seq > highest + 1) {
      throw new Error(
        `event ${event.sessionId}#${event.seq} would leave a hole after #${highest}; the log is gapless`,
      )
    }

    await mkdir(this.#dir(), { recursive: true })
    await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' })
  }

  async read(sessionId: string): Promise<AnyEvent[]> {
    const file = await this.#fileFor(sessionId)
    const events: AnyEvent[] = []
    for (const { number, text } of await this.#lines(file)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${file}:${number} is not valid JSON`)
      }
      // Upcast on the way in, so a row written under an older schema version is still readable
      // (STACK §6). Today the registry is empty and this is the identity.
      events.push(readEvent(parsed, `${file}:${number}`))
    }
    return events
  }

  async listSessions(): Promise<string[]> {
    const found = new Set<string>()
    for (const dir of this.#searchPath()) {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      for (const name of entries) {
        if (name.endsWith(EXTENSION)) found.add(name.slice(0, -EXTENSION.length))
      }
    }
    return [...found].sort()
  }

  #dir(): string {
    return join(this.#root, this.#ownerId)
  }

  // Only the local owner sees the flat layout; a second owner never reads a file it did not write.
  #searchPath(): string[] {
    return this.#ownerId === LOCAL_OWNER_ID ? [this.#dir(), this.#root] : [this.#dir()]
  }

  async #fileFor(sessionId: string): Promise<string> {
    if (!SAFE_NAME.test(sessionId)) {
      throw new Error(`session id ${JSON.stringify(sessionId)} is not usable as a log filename`)
    }
    const owned = join(this.#dir(), `${sessionId}${EXTENSION}`)
    if (this.#ownerId !== LOCAL_OWNER_ID) return owned
    if ((await this.#lines(owned)).length > 0) return owned

    const flat = join(this.#root, `${sessionId}${EXTENSION}`)
    return (await this.#lines(flat)).length > 0 ? flat : owned
  }

  async #lines(file: string): Promise<{ number: number; text: string }[]> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return raw
      .split('\n')
      .map((text, index) => ({ number: index + 1, text }))
      .filter(({ text }) => text.trim() !== '')
  }

  // Scans every line rather than trusting the last one, in case the file was edited by hand. This
  // read-then-append is not atomic — fine only because the CLI is a single writer per session.
  async #highestSeq(file: string): Promise<number> {
    let highest = -1
    for (const { number, text } of await this.#lines(file)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(`${file}:${number} is not valid JSON`)
      }
      const seq: unknown = (parsed as { seq?: unknown } | null)?.seq
      if (typeof seq !== 'number' || !Number.isInteger(seq)) {
        throw new Error(`${file}:${number} has no integer seq`)
      }
      highest = Math.max(highest, seq)
    }
    return highest
  }
}
