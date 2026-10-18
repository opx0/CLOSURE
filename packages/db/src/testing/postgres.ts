import type { SqlPool } from '../sql.ts'

export interface TestPool extends SqlPool {
  end(): Promise<void>
}

export interface TestDatabase {
  pool: TestPool
  close(): Promise<void>
}

// `pg` ships no types and isn't a dependency here, so the driver is loaded through a specifier
// TypeScript can't resolve statically — only this test helper needs it at all.
const DRIVER: string = 'pg'

interface PoolConfig {
  connectionString: string
  connectionTimeoutMillis: number
  options?: string
}

async function openPool(url: string, options?: string): Promise<TestPool | undefined> {
  const driver = (await import(DRIVER)) as unknown as {
    Pool: new (config: PoolConfig) => TestPool
  }
  const pool = new driver.Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
    ...(options === undefined ? {} : { options }),
  })
  try {
    await pool.query('select 1')
    return pool
  } catch {
    await pool.end().catch(() => undefined)
    return undefined
  }
}

// Each integration test gets its own schema, dropped after — the events table refuses DELETE and
// TRUNCATE, so dropping the schema is the only teardown available.
export async function openTestDatabase(
  url: string,
  schema: string,
): Promise<TestDatabase | undefined> {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`unsafe test schema name ${schema}`)

  const bootstrap = await openPool(url)
  if (bootstrap === undefined) return undefined

  await bootstrap.query(`create schema if not exists "${schema}"`)
  const scoped = await openPool(url, `-c search_path=${schema},public`)
  if (scoped === undefined) {
    await bootstrap.end()
    return undefined
  }

  return {
    pool: scoped,
    close: async () => {
      await scoped.end()
      await bootstrap.query(`drop schema if exists "${schema}" cascade`)
      await bootstrap.end()
    },
  }
}
