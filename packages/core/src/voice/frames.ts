import {
  VOICE_FRAME_HEADER_BYTES,
  VOICE_LIVE_FRAMES,
  VOICE_PCM_BYTES_PER_FRAME,
  VOICE_RECOVERY_FRAMES,
  type VoiceServerMessage,
} from '@levelhead/contracts'

export interface PcmFrame {
  seq: number
  pcm: Uint8Array
}

export function decodePcmFrame(bytes: Uint8Array): PcmFrame {
  if (bytes.byteLength !== VOICE_FRAME_HEADER_BYTES + VOICE_PCM_BYTES_PER_FRAME)
    throw new Error('invalid_frame')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { seq: view.getUint32(0, true), pcm: bytes.slice(VOICE_FRAME_HEADER_BYTES) }
}

export function encodePcmFrame(frame: PcmFrame): Uint8Array {
  if (
    !Number.isInteger(frame.seq) ||
    frame.seq < 0 ||
    frame.seq > 0xffffffff ||
    frame.pcm.byteLength !== VOICE_PCM_BYTES_PER_FRAME
  )
    throw new Error('invalid_frame')
  const bytes = new Uint8Array(VOICE_FRAME_HEADER_BYTES + VOICE_PCM_BYTES_PER_FRAME)
  new DataView(bytes.buffer).setUint32(0, frame.seq, true)
  bytes.set(frame.pcm, VOICE_FRAME_HEADER_BYTES)
  return bytes
}

// A single answer's wire state. Consumers must drain frames to the recognizer and acknowledge
// them explicitly. Queue overflow is reported and pauses intake; no audio is discarded as success.
export class VoiceFrameQueue {
  private readonly frames: PcmFrame[] = []
  private nextSeq = 0
  private ackedSeq = -1
  private done: { requestId: string; lastSeq: number } | null = null
  private stopped = false

  accept(bytes: Uint8Array): VoiceServerMessage {
    if (this.stopped || this.done !== null)
      return { kind: 'error', code: 'stopped', detail: 'Answer is closed to audio' }
    let frame: PcmFrame
    try {
      frame = decodePcmFrame(bytes)
    } catch {
      return {
        kind: 'error',
        code: 'invalid_frame',
        detail: 'Expected one 100 ms PCM16 mono frame',
      }
    }
    if (frame.seq < this.nextSeq) {
      return frame.seq <= this.ackedSeq
        ? { kind: 'ack', seq: this.ackedSeq }
        : { kind: 'error', code: 'out_of_order', detail: 'Frame already queued' }
    }
    if (frame.seq !== this.nextSeq)
      return { kind: 'error', code: 'out_of_order', detail: `Expected frame ${this.nextSeq}` }
    if (
      this.frames.length >= VOICE_LIVE_FRAMES ||
      this.nextSeq - this.ackedSeq - 1 >= VOICE_RECOVERY_FRAMES
    )
      return {
        kind: 'error',
        code: 'queue_full',
        detail: 'Audio paused until the recognizer catches up',
      }
    this.frames.push(frame)
    this.nextSeq += 1
    return { kind: 'queued', seq: frame.seq }
  }

  take(): PcmFrame | undefined {
    return this.frames.shift()
  }

  matchesPending(bytes: Uint8Array): boolean {
    let frame: PcmFrame
    try {
      frame = decodePcmFrame(bytes)
    } catch {
      return false
    }
    const pending = this.frames.find((item) => item.seq === frame.seq)
    return pending !== undefined && pending.pcm.every((byte, at) => byte === frame.pcm[at])
  }

  acknowledge(seq: number): VoiceServerMessage {
    if (!Number.isInteger(seq) || seq < 0 || seq >= this.nextSeq || seq > this.ackedSeq + 1)
      return { kind: 'error', code: 'out_of_order', detail: 'Cannot acknowledge an unseen frame' }
    this.ackedSeq = Math.max(this.ackedSeq, seq)
    return { kind: 'ack', seq: this.ackedSeq }
  }

  finish(requestId: string, lastSeq: number): boolean {
    if (this.done !== null)
      return this.done.requestId === requestId && this.done.lastSeq === lastSeq
    if (this.stopped || !requestId || lastSeq !== this.nextSeq - 1 || this.ackedSeq !== lastSeq)
      return false
    this.done = { requestId, lastSeq }
    return true
  }

  stop(): void {
    this.stopped = true
    this.frames.length = 0
  }

  get pending(): number {
    return this.frames.length
  }

  get acknowledgedSeq(): number {
    return this.ackedSeq
  }

  get expectedSeq(): number {
    return this.nextSeq
  }
}

// Provisional ASR text can change as recognition proceeds. Only the one final revision may be
// submitted as an answer; edits to an already accepted answer use the separate correction log.
export class VoiceTranscript {
  private current: { revision: number; text: string; final: boolean } | null = null

  revise(update: { revision: number; text: string; final: boolean }): boolean {
    if (!Number.isSafeInteger(update.revision) || update.revision < 1) return false
    if (this.current?.final)
      return (
        this.current.revision === update.revision &&
        this.current.text === update.text &&
        update.final
      )
    if (this.current !== null && update.revision <= this.current.revision)
      return (
        this.current.revision === update.revision &&
        this.current.text === update.text &&
        this.current.final === update.final
      )
    this.current = { ...update }
    return true
  }

  get provisionalText(): string {
    return this.current?.text ?? ''
  }

  get acceptedText(): string | null {
    return this.current?.final ? this.current.text : null
  }

  get currentRevision(): { revision: number; text: string; final: boolean } | null {
    return this.current === null ? null : { ...this.current }
  }
}
