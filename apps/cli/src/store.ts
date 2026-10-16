import { Pool } from 'pg'
import { PostgresEventStore } from '@levelhead/db'
import type { EventStore } from '@levelhead/core'
import { JsonlEventStore } from './store/jsonl.ts'
import type { CliConfig } from './config.ts'

// Both stores implement the same port and enforce the same append-only property, so this is a
// choice of deployment, not of semantics.
export function openStore(config: CliConfig): { store: EventStore; close: () => Promise<void> } {
  if (config.store !== 'postgres') {
    return {
      store: new JsonlEventStore(config.eventDir, config.ownerId),
      close: async () => {},
    }
  }
  if (config.databaseUrl === undefined) {
    process.stderr.write('LEVELHEAD_STORE=postgres needs DATABASE_URL.\n')
    process.exit(1)
  }
  const pool = new Pool({ connectionString: config.databaseUrl })
  return { store: new PostgresEventStore(pool, config.ownerId), close: () => pool.end() }
}
