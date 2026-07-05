import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AnyEvent } from '@closer/contracts'
import { assertValidEvent, type EventStore } from '@closer/core'

const EXTENSION = '.jsonl'

export interface SessionImport {
  sessionId: string
  file: string
  imported: number
  skipped: number
}

export interface JsonlImportReport {
  sessions: SessionImport[]
  imported: number
  skipped: number
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}

// Written out here rather than imported from apps/cli — a package depending on an app would invert
// the layering. Read-only by construction, so a half-finished import leaves the JSONL log untouched.
async function eventsInFile(file: string, sessionId: string): Promise<AnyEvent[]> {
  const raw = await readFile(file, 'utf8')
  const parsedEvents: AnyEvent[] = []

  for (const [index, text] of raw.split('\n').entries()) {
    if (text.trim() === '') continue
    const line = `${file}:${index + 1}`

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`${line} is not valid JSON`)
    }
    assertValidEvent(parsed, line)

    // Filename is the session id in the JSONL store — a mismatch means the export was hand-assembled
    // and would file events under the wrong session.
    if (parsed.sessionId !== sessionId) {
      throw new Error(`${line} belongs to session ${parsed.sessionId}, not ${sessionId}`)
    }
    parsedEvents.push(parsed)
  }

  return parsedEvents.sort((a, b) => a.seq - b.seq)
}

async function importSession(
  store: EventStore,
  file: string,
  sessionId: string,
): Promise<SessionImport> {
  const fromFile = await eventsInFile(file, sessionId)
  const stored = new Map((await store.read(sessionId)).map((event) => [event.seq, event]))

  let imported = 0
  let skipped = 0
  for (const event of fromFile) {
    const already = stored.get(event.seq)
    if (already !== undefined) {
      // More than "don't insert twice" — a stored event differing from the file at the same seq
      // means the histories diverged, and skipping it would bury that fact.
      if (already.eventId !== event.eventId) {
        throw new Error(
          `${sessionId}#${event.seq} is stored as ${already.eventId} but ${file} has ${event.eventId}; the log and the file have diverged`,
        )
      }
      skipped += 1
      continue
    }
    await store.append(event)
    imported += 1
  }

  return { sessionId, file, imported, skipped }
}

// Replays the JSONL files into the same EventStore interface, in seq order. Re-running is safe — an
// already-migrated session is skipped, a partial one resumes where it left off.
export async function importJsonlDirectory(
  store: EventStore,
  dir: string,
): Promise<JsonlImportReport> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(EXTENSION)).sort()
  } catch (error) {
    if (isMissing(error)) return { sessions: [], imported: 0, skipped: 0 }
    throw error
  }

  const sessions: SessionImport[] = []
  for (const name of files) {
    sessions.push(await importSession(store, join(dir, name), name.slice(0, -EXTENSION.length)))
  }

  return {
    sessions,
    imported: sessions.reduce((total, session) => total + session.imported, 0),
    skipped: sessions.reduce((total, session) => total + session.skipped, 0),
  }
}
