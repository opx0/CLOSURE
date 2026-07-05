// Shaped rather than imported from `pg` — `pg` ships no types, and having the executor be an
// argument lets every statement be asserted with no database behind it.
export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number | null
}

export interface SqlExecutor {
  query(text: string, values?: unknown[]): Promise<QueryResult>
}

// A pool can't run BEGIN — the next statement might land on a different connection — so transactions
// need one held client, `pg.PoolClient`.
export interface SqlClient extends SqlExecutor {
  release(): void
}

export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>
}

export const UNIQUE_VIOLATION = '23505'

export interface DriverFault {
  code: string
  constraint: string | undefined
}

// Translates a raw driver error rather than let one leak — the caller needs to know its log was
// rewritten, not a constraint name.
export function driverFault(error: unknown): DriverFault | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { code, constraint } = error as { code?: unknown; constraint?: unknown }
  if (typeof code !== 'string') return undefined
  return { code, constraint: typeof constraint === 'string' ? constraint : undefined }
}
