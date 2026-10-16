import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'

type Check = { name: string; ok: boolean; detail: string }

async function llamaReachable(baseUrl: string): Promise<Check> {
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(2000) })
    return {
      name: 'local model (llama.cpp)',
      ok: response.ok,
      detail: response.ok ? baseUrl : `${baseUrl} answered ${response.status}`,
    }
  } catch (error) {
    return {
      name: 'local model (llama.cpp)',
      ok: false,
      detail: `${baseUrl} unreachable — start it with \`bun run llama:up\` (${String(error)})`,
    }
  }
}

async function eventDirWritable(dir: string): Promise<Check> {
  const probe = join(dir, '.probe')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(probe, '')
    await rm(probe)
    return { name: 'event log directory', ok: true, detail: dir }
  } catch (error) {
    return { name: 'event log directory', ok: false, detail: `${dir}: ${String(error)}` }
  }
}

async function gitPresent(): Promise<Check> {
  return new Promise((settle) => {
    execFile('git', ['--version'], { timeout: 3_000 }, (error, stdout) => {
      settle(
        error === null
          ? { name: 'git (repository reader)', ok: true, detail: stdout.trim() }
          : {
              name: 'git (repository reader)',
              ok: false,
              detail: 'git is not on PATH; `levelhead repo` reads snapshots through it',
            },
      )
    })
  })
}

async function databaseReachable(url: string | undefined): Promise<Check> {
  if (url === undefined) {
    return {
      name: 'postgres',
      ok: true,
      detail: 'DATABASE_URL unset — the file-backed event log needs no container',
    }
  }
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2_000 })
  try {
    const { rows } = await pool.query('select count(*)::int as applied from schema_migrations')
    return {
      name: 'postgres',
      ok: true,
      detail: `reachable · ${Number(rows[0]?.['applied'] ?? 0)} migrations applied`,
    }
  } catch (error) {
    return {
      name: 'postgres',
      ok: false,
      detail: `${String(error)} — try \`bun run db:up\` then \`bun run db:migrate\``,
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

async function webBuilt(): Promise<Check> {
  try {
    await stat('apps/web/dist/index.html')
    return { name: 'web client', ok: true, detail: 'apps/web/dist is built' }
  } catch {
    return {
      name: 'web client',
      // Not a failure: the server falls back to the dependency-free page.
      ok: true,
      detail: 'not built — run `bun run web:build` for the evidence UI at /app/',
    }
  }
}

export async function doctor(): Promise<number> {
  const config = loadCliConfig()
  const checks: Check[] = [
    await eventDirWritable(config.eventDir),
    await gitPresent(),
    await databaseReachable(config.databaseUrl),
    await webBuilt(),
    await llamaReachable(config.llamaBaseUrl),
    {
      name: 'evaluator provider',
      // Not a failure — the loop runs end to end on the local model with no key.
      ok: true,
      detail: config.apiKey
        ? `${config.modelId} via MODEL_PROVIDER_API_KEY`
        : `no MODEL_PROVIDER_API_KEY — the Evaluator will run locally, which is for wiring only`,
    },
  ]

  heading('levelhead doctor')
  for (const check of checks) {
    line(`${check.ok ? '✓' : '✗'} ${check.name}`)
    dim(`  ${check.detail}`)
  }
  line('')
  dim(`  owner: ${config.ownerId} · store: ${config.store}`)
  dim('  practice only. Levelhead never runs during a real interview.')
  return checks.every((check) => check.ok) ? 0 : 1
}
