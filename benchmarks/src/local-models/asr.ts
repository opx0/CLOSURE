import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { WebSocket } from 'ws'
import { VOICE_FRAME_MS, VOICE_PCM_BYTES_PER_FRAME, VOICE_SAMPLE_RATE } from '@levelhead/contracts'

export interface ReviewedSpeechCase {
  id: string
  wavPath: string
  sha256: string
  reference: string
  criticalPhrases: string[]
  reviewedBy: string
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

export function wordErrorRate(reference: string, observed: string): number {
  const expected = words(reference)
  const actual = words(observed)
  if (!expected.length) throw new Error('Reviewed reference must contain words')
  let prior = Array.from({ length: actual.length + 1 }, (_, index) => index)
  for (const [index, word] of expected.entries()) {
    const next = [index + 1]
    for (const [position, candidate] of actual.entries())
      next.push(
        Math.min(
          next[position]! + 1,
          prior[position + 1]! + 1,
          prior[position]! + Number(word !== candidate),
        ),
      )
    prior = next
  }
  return prior[actual.length]! / expected.length
}

export function missingCriticalPhrases(reference: string, observed: string, phrases: string[]) {
  const normalizedReference = ` ${words(reference).join(' ')} `
  const normalizedObserved = ` ${words(observed).join(' ')} `
  return phrases.filter((phrase) => {
    const normalized = ` ${words(phrase).join(' ')} `
    if (normalized === '  ' || !normalizedReference.includes(normalized))
      throw new Error('Critical phrase must occur in the reviewed reference')
    return !normalizedObserved.includes(normalized)
  })
}

function pcmFromWav(bytes: Buffer): Buffer {
  if (bytes.length < 12) throw new Error('Expected a RIFF/WAVE file')
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Expected a RIFF/WAVE file')
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('WAV length mismatch')
  let format = false
  let pcm: Buffer | null = null
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > bytes.length) throw new Error('Truncated WAV chunk')
    const name = bytes.toString('ascii', offset, offset + 4)
    if (name === 'fmt ') {
      if (
        size < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 2) !== 1 ||
        bytes.readUInt32LE(start + 4) !== VOICE_SAMPLE_RATE ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        throw new Error('WAV must be mono PCM16 at 16 kHz')
      format = true
    }
    if (name === 'data') {
      if (pcm !== null) throw new Error('Multiple WAV data chunks')
      pcm = bytes.subarray(start, start + size)
    }
    offset = start + size + (size % 2)
  }
  if (!format || pcm === null || pcm.length < 2 || pcm.length % 2)
    throw new Error('WAV has no usable PCM')
  return pcm
}

export async function runStreamingAsrCase(
  speechCase: ReviewedSpeechCase,
  endpoint: string,
  token: string,
  timeoutMs = 120_000,
) {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'ws:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Streaming benchmark requires a loopback WebSocket endpoint')
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) throw new Error('A local sidecar token is required')
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(speechCase.id) ||
    !speechCase.reviewedBy.trim() ||
    !speechCase.reference.trim() ||
    !/^[a-f0-9]{64}$/.test(speechCase.sha256)
  )
    throw new Error('Invalid reviewed speech case')
  const file = await stat(speechCase.wavPath)
  if (!file.isFile() || file.size > 2_000_000)
    throw new Error('Reviewed WAV must be a regular file no longer than one minute')
  const bytes = await readFile(speechCase.wavPath)
  if (createHash('sha256').update(bytes).digest('hex') !== speechCase.sha256)
    throw new Error('Reviewed WAV checksum mismatch')
  missingCriticalPhrases(speechCase.reference, speechCase.reference, speechCase.criticalPhrases)
  const pcm = pcmFromWav(bytes)
  const frames = Math.ceil(pcm.length / VOICE_PCM_BYTES_PER_FRAME)
  if (frames > 600) throw new Error('Reviewed speech case exceeds one minute')
  const started = performance.now()
  const socket = new WebSocket(endpoint, [`lh-sidecar.${token}`])
  return await new Promise<{
    id: string
    observed: string
    wordErrorRate: number
    missingCriticalPhrases: string[]
    audioMs: number
    finalLagMs: number
    elapsedMs: number
    wavSha256: string
  }>((resolve, reject) => {
    let next = 0
    let lastAck = -1
    let doneSent = false
    let lastSentAt = started
    let settled = false
    const timeout = setTimeout(() => finish(new Error('Streaming ASR timed out')), timeoutMs)
    const finish = (error?: Error, final?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.close()
      if (error) return reject(error)
      const observed = final ?? ''
      resolve({
        id: speechCase.id,
        observed,
        wordErrorRate: wordErrorRate(speechCase.reference, observed),
        missingCriticalPhrases: missingCriticalPhrases(
          speechCase.reference,
          observed,
          speechCase.criticalPhrases,
        ),
        audioMs: Math.round((pcm.length / 2 / VOICE_SAMPLE_RATE) * 1000),
        finalLagMs: Math.max(0, Math.round(performance.now() - lastSentAt - VOICE_FRAME_MS)),
        elapsedMs: Math.round(performance.now() - started),
        wavSha256: speechCase.sha256,
      })
    }
    const sendFrame = () => {
      const frame = Buffer.alloc(4 + VOICE_PCM_BYTES_PER_FRAME)
      frame.writeUInt32LE(next, 0)
      pcm.copy(frame, 4, next * VOICE_PCM_BYTES_PER_FRAME, (next + 1) * VOICE_PCM_BYTES_PER_FRAME)
      lastSentAt = performance.now()
      socket.send(frame)
      next++
    }
    socket.on('open', sendFrame)
    socket.on('message', (raw) => {
      let message: { kind?: string; seq?: number; text?: string; final?: boolean; detail?: string }
      try {
        message = JSON.parse(String(raw))
      } catch {
        finish(new Error('Invalid recognizer response'))
        return
      }
      if (message.kind === 'error') return finish(new Error('Recognizer rejected the case'))
      if (message.kind === 'ack') {
        if (message.seq !== next - 1 || message.seq <= lastAck)
          return finish(new Error('Unexpected recognizer acknowledgement'))
        lastAck = message.seq
        if (next < frames)
          setTimeout(() => {
            if (!settled) sendFrame()
          }, VOICE_FRAME_MS)
        else {
          setTimeout(() => {
            if (settled) return
            doneSent = true
            socket.send(
              JSON.stringify({ kind: 'done', requestId: speechCase.id, lastSeq: next - 1 }),
            )
          }, VOICE_FRAME_MS)
        }
      } else if (message.kind === 'transcript' && message.final) {
        if (typeof message.text !== 'string' || !doneSent)
          return finish(new Error('Invalid final transcript'))
        finish(undefined, message.text)
      }
    })
    socket.on('error', () => finish(new Error('Streaming recognizer unavailable')))
    socket.on('close', () => finish(new Error('Streaming recognizer closed before final text')))
  })
}
