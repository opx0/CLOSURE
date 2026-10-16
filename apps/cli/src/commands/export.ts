import { dirname, basename } from 'node:path'
import { buildExportBundle } from '@levelhead/core'
import { LocalObjectStore } from '../store/objects.ts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { SystemClock } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

export async function exportAll(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)
  const clock = new SystemClock()

  try {
    const sessions = []
    for (const sessionId of await store.listSessions()) {
      sessions.push({ sessionId, events: await store.read(sessionId) })
    }

    const bundle = buildExportBundle({
      ownerId: config.ownerId,
      producedAt: clock.now(),
      sessions,
    })

    const destination = flag(argv, 'out') ?? `.levelhead/exports/${config.ownerId}.json`
    // Through the object-store port (ADR-017), so the same code writes to a bucket the day the
    // deployment has one.
    const objects = new LocalObjectStore(dirname(destination))
    const written = await objects.put(basename(destination), `${JSON.stringify(bundle, null, 2)}\n`)

    const events = bundle.sessions.reduce((total, session) => total + session.events.length, 0)
    const findings = bundle.sessions.reduce((total, session) => total + session.findings.length, 0)

    heading('exported')
    line(`  ${destination}`)
    dim(
      `  ${bundle.sessions.length} sessions · ${events} events · ${findings} findings · ${written.bytes} bytes`,
    )
    dim(`  sha256 ${written.contentHash.slice(0, 16)}`)
    dim('  this is everything Levelhead holds about you, in the form it reads it.')
    return 0
  } finally {
    await close()
  }
}
