import { join } from 'node:path'
import { LOCAL_OWNER_ID } from '@levelhead/contracts'
import { importJsonlDirectory } from '@levelhead/db'
import { loadCliConfig } from '../config.ts'
import { openStore } from '../store.ts'
import { dim, heading, line } from '../terminal.ts'

// Idempotent — safe to run twice. A stored event differing from the file at the same seq is raised
// as a divergence, never silently skipped.
export async function importLogs(argv: readonly string[]): Promise<number> {
  const config = { ...loadCliConfig(), store: 'postgres' as const }
  const at = argv.indexOf('--from')
  const from = at === -1 ? config.eventDir : (argv[at + 1] ?? config.eventDir)
  const { store, close } = openStore(config)

  // The file store keeps one directory per owner, and the local owner also reads the flat layout
  // logs were written in before the boundary existed. Both are imported, into the owner-scoped
  // Postgres store, so a pre-boundary log is not left behind by the migration that follows it.
  const directories =
    config.ownerId === LOCAL_OWNER_ID
      ? [join(from, config.ownerId), from]
      : [join(from, config.ownerId)]

  try {
    heading(`importing ${from} → postgres (owner ${config.ownerId})`)
    let imported = 0
    let skipped = 0
    for (const directory of directories) {
      const report = await importJsonlDirectory(store, directory)
      for (const session of report.sessions) {
        line(
          `  ${session.sessionId}: ${session.imported} imported, ${session.skipped} already there`,
        )
      }
      imported += report.imported
      skipped += report.skipped
    }
    dim(
      `  ${imported} events imported, ${skipped} already present. The files are left alone; nothing is deleted.`,
    )
    return 0
  } finally {
    await close()
  }
}
