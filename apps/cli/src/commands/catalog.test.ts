import { test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOPICS } from '@levelhead/core'

const CLI = join(import.meta.dir, '..', 'index.ts')
const STYLES = ['\u001b[1m', '\u001b[2m', '\u001b[0m']

async function levelhead(args: readonly string[]): Promise<{ code: number; out: string }> {
  const eventDir = await mkdtemp(join(tmpdir(), 'levelhead-catalog-'))
  try {
    const proc = Bun.spawn(['bun', CLI, ...args], {
      env: { ...process.env, LEVELHEAD_EVENT_DIR: eventDir, LEVELHEAD_STORE: 'jsonl' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    const err = await new Response(proc.stderr).text()
    const plain = STYLES.reduce((text, style) => text.replaceAll(style, ''), out + err)
    return { code: await proc.exited, out: plain }
  } finally {
    await rm(eventDir, { recursive: true, force: true })
  }
}

test('topics lists id, area, title and level for what a role can be asked', async () => {
  const result = await levelhead(['topics', '--role', 'frontend', '--area', 'web'])

  expect(result.code).toBe(0)
  expect(result.out.split('\n')).toEqual([
    '',
    'topics · Frontend engineer',
    '',
    '  role knowledge',
    '    web.event_loop          web · JavaScript event loop · from junior',
    '    web.cors                web · CORS · from junior',
    '    web.rendering_pipeline  web · Browser rendering pipeline · from junior',
    '    web.react_rendering     web · React rendering and state · from junior',
    '    web.client_storage      web · Cookies, localStorage and tokens · from junior',
    '',
    '  the interviewer picks from these; ask for some by id: levelhead session --topics <id,id>',
    '',
  ])
}, 20_000)

test('a role only reaches the role-knowledge areas its pack names', async () => {
  const result = await levelhead(['topics', '--role', 'frontend'])

  expect(result.code).toBe(0)
  expect(result.out).toContain('    os.deadlock ')
  expect(result.out).toContain('system_design.rate_limiter')
  expect(result.out).toContain('Rate limiter · from mid')
  expect(result.out).toContain('web.cors')
  expect(result.out).not.toContain('backend.pagination')
  expect(result.out).not.toContain('ml.rag')
  for (const topic of TOPICS) {
    expect(result.out).not.toContain(topic.falsePremise)
    expect(result.out).not.toContain(topic.twist)
  }
}, 20_000)

test('an unknown area or role is refused with where to look', async () => {
  const area = await levelhead(['topics', '--area', 'quantum'])
  expect(area.code).toBe(1)
  expect(area.out).toContain(
    'no topic area named quantum — one of: os, dbms, networks, oop, dsa, system_design, web, backend, ml, data, devops, behavioral',
  )

  const role = await levelhead(['topics', '--role', 'astronaut'])
  expect(role.code).toBe(1)
  expect(role.out).toContain('no role pack named astronaut — run: levelhead roles')
}, 20_000)

test('roles shows the areas each role knowledge round draws on', async () => {
  const result = await levelhead(['roles'])

  expect(result.code).toBe(0)
  expect(result.out).toContain('  frontend  Frontend engineer')
  expect(result.out).toContain('    role knowledge draws on: web\n')
  expect(result.out).toContain('    role knowledge draws on: devops, backend\n')
}, 20_000)
