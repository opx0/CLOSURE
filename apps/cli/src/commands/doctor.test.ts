import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eventDirWritable, speechReadiness } from './doctor.ts'

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
