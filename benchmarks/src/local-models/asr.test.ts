import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { WebSocketServer } from 'ws'
import { VOICE_PCM_BYTES_PER_FRAME } from '@levelhead/contracts'
import { missingCriticalPhrases, runStreamingAsrCase, wordErrorRate } from './asr.ts'

function wav(pcm: Buffer): Buffer {
  const bytes = Buffer.alloc(44 + pcm.length)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(pcm.length, 40)
  pcm.copy(bytes, 44)
  return bytes
}

test('reviewed transcripts measure word errors and missing meaning-critical phrases', () => {
  expect(wordErrorRate('Lease recovery works.', 'Lease recovery')).toBeCloseTo(1 / 3)
  expect(
    missingCriticalPhrases('Lease recovery works.', 'Lease recovery', ['recovery works']),
  ).toEqual(['recovery works'])
  expect(() => missingCriticalPhrases('Lease recovery works.', '', ['idempotency key'])).toThrow(
    'reviewed reference',
  )
})

test('a reviewed WAV streams paced frames to a local recognizer and records an observed final', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'levelhead-asr-case-'))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  try {
    const file = join(dir, 'sample.wav')
    const bytes = wav(Buffer.alloc(VOICE_PCM_BYTES_PER_FRAME * 2))
    await writeFile(file, bytes)
    const received: number[] = []
    server.on('connection', (socket) => {
      socket.on('message', (data, binary) => {
        if (binary) {
          const seq = Buffer.from(data as Buffer).readUInt32LE(0)
          received.push(seq)
          socket.send(JSON.stringify({ kind: 'ack', seq }))
        } else {
          expect(JSON.parse(String(data))).toEqual({
            kind: 'done',
            requestId: 'case_1',
            lastSeq: 1,
          })
          socket.send(
            JSON.stringify({
              kind: 'transcript',
              revision: 1,
              final: true,
              text: 'lease recovery',
            }),
          )
        }
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No local listener')
    const speechCase = {
      id: 'case_1',
      wavPath: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      reference: 'Lease recovery works.',
      criticalPhrases: ['recovery works'],
      reviewedBy: 'reviewer',
    }
    const endpoint = `ws://127.0.0.1:${address.port}`
    const result = await runStreamingAsrCase(speechCase, endpoint, 'test_token_123456')
    expect(received).toEqual([0, 1])
    expect(result).toMatchObject({
      id: 'case_1',
      observed: 'lease recovery',
      audioMs: 200,
      missingCriticalPhrases: ['recovery works'],
    })
    expect(result.wordErrorRate).toBeCloseTo(1 / 3)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(190)
    await expect(
      runStreamingAsrCase({ ...speechCase, sha256: '0'.repeat(64) }, endpoint, 'test_token_123456'),
    ).rejects.toThrow('checksum')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  }
})
