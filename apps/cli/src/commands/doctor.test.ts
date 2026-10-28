import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eventDirWritable, llamaReachable, speechReadiness } from './doctor.ts'

test('doctor preserves pre-existing probe files and cleans up its own directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-doctor-'))
  try {
    await writeFile(join(dir, '.probe'), 'keep')
    expect((await eventDirWritable(dir)).ok).toBe(true)
    expect(await readFile(join(dir, '.probe'), 'utf8')).toBe('keep')
    expect(await readdir(dir)).toEqual(['.probe'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('speech health distinguishes batch availability from unverified streaming', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return Response.json({ status: 'ok', whisperModel: 'base.en', piperVoice: 'test' })
    },
  })
  try {
    const check = await speechReadiness(String(server.port))
    expect(check.detail).toContain('batch ASR/full-WAV TTS reachable')
    expect(check.detail).toContain('unverified')
  } finally {
    server.stop(true)
  }
})

test('doctor does not mistake any HTTP 200 or a redirect for a ready local model', async () => {
  const target = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      switch (new URL(request.url).pathname) {
        case '/valid/models':
          return Response.json({ object: 'list', data: [{ id: 'local-model' }] })
        case '/empty/models':
          return Response.json({ object: 'list', data: [] })
        case '/redirect/models':
          return Response.redirect('https://example.com/models', 307)
        default:
          return new Response('<html>not a model</html>', { status: 200 })
      }
    },
  })
  try {
    expect((await llamaReachable(`${target.url}valid`)).ok).toBe(true)
    expect((await llamaReachable(`${target.url}valid`)).detail).toContain(
      'inference and quality unverified',
    )
    expect((await llamaReachable(`${target.url}empty`)).ok).toBe(false)
    expect((await llamaReachable(`${target.url}html`)).ok).toBe(false)
    expect((await llamaReachable(`${target.url}redirect`)).ok).toBe(false)
  } finally {
    target.stop(true)
  }
})
