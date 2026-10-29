import { expect, test } from 'bun:test'
import { VOICE_LIVE_FRAMES, VOICE_PCM_BYTES_PER_FRAME } from '@levelhead/contracts'
import { decodePcmFrame, encodePcmFrame, VoiceFrameQueue, VoiceTranscript } from './frames.ts'

const frame = (seq: number) =>
  encodePcmFrame({ seq, pcm: new Uint8Array(VOICE_PCM_BYTES_PER_FRAME) })

test('PCM frames preserve little-endian sequence and reject malformed sizes', () => {
  expect(decodePcmFrame(frame(0x12345678)).seq).toBe(0x12345678)
  expect(() => decodePcmFrame(new Uint8Array(VOICE_PCM_BYTES_PER_FRAME))).toThrow('invalid_frame')
  expect(() =>
    encodePcmFrame({ seq: -1, pcm: new Uint8Array(VOICE_PCM_BYTES_PER_FRAME) }),
  ).toThrow()
})

test('out-of-order, duplicate, repeated Done and long pauses cannot silently finish an answer', () => {
  const queue = new VoiceFrameQueue()
  expect(queue.accept(frame(1))).toMatchObject({ kind: 'error', code: 'out_of_order' })
  queue.accept(frame(0))
  expect(queue.matchesPending(frame(0))).toBe(true)
  const changed = frame(0)
  changed[4] = 1
  expect(queue.matchesPending(changed)).toBe(false)
  expect(queue.accept(frame(0))).toMatchObject({ kind: 'error', code: 'out_of_order' })
  expect(queue.finish('done-1', 0)).toBe(false)
  expect(queue.take()?.seq).toBe(0)
  expect(queue.acknowledge(0)).toEqual({ kind: 'ack', seq: 0 })
  expect(queue.accept(frame(0))).toEqual({ kind: 'ack', seq: 0 })
  // Time is irrelevant: only an explicit Done can finish the accepted frame sequence.
  expect(queue.finish('done-1', 0)).toBe(true)
  expect(queue.finish('done-1', 0)).toBe(true)
  expect(queue.finish('different', 0)).toBe(false)
  expect(queue.accept(frame(1))).toMatchObject({ kind: 'error', code: 'stopped' })
})

test('backpressure rejects overflow without consuming a sequence', () => {
  const queue = new VoiceFrameQueue()
  for (let seq = 0; seq < VOICE_LIVE_FRAMES; seq += 1) queue.accept(frame(seq))
  expect(queue.pending).toBe(VOICE_LIVE_FRAMES)
  expect(queue.accept(frame(VOICE_LIVE_FRAMES))).toMatchObject({
    kind: 'error',
    code: 'queue_full',
  })
  expect(queue.take()?.seq).toBe(0)
  queue.acknowledge(0)
  expect(queue.accept(frame(VOICE_LIVE_FRAMES)).kind).toBe('queued')
  queue.stop()
  expect(queue.pending).toBe(0)
  expect(queue.finish('late', VOICE_LIVE_FRAMES)).toBe(false)
})

test('provisional revisions never become an accepted answer; stale and conflicting finals lose', () => {
  const transcript = new VoiceTranscript()
  expect(transcript.revise({ revision: 1, text: 'I built', final: false })).toBe(true)
  expect(transcript.acceptedText).toBeNull()
  expect(transcript.revise({ revision: 2, text: 'We built it', final: false })).toBe(true)
  expect(transcript.revise({ revision: 1, text: 'I built', final: false })).toBe(false)
  expect(transcript.revise({ revision: 3, text: 'We built it with a queue.', final: true })).toBe(
    true,
  )
  expect(transcript.acceptedText).toBe('We built it with a queue.')
  expect(transcript.revise({ revision: 3, text: 'Changed', final: true })).toBe(false)
  expect(transcript.revise({ revision: 4, text: 'Late ASR', final: false })).toBe(false)
  expect(transcript.revise({ revision: 3, text: 'We built it with a queue.', final: true })).toBe(
    true,
  )
})
