import { api } from '../api/client.ts'

const FRAME_BYTES = 3200
const MAX_LIVE = 20
const MAX_RECOVERY = 100
const RECONNECT_MS = 10_000

export interface LiveSpeech {
  done(): void
  pause(): void
  resume(): void
  stop(): void
}

export async function startLiveSpeech(
  sessionId: string,
  onTranscript: (text: string, final: boolean) => void,
  onError: (message: string) => void,
  onStatus: (message: string) => void = () => {},
): Promise<LiveSpeech> {
  let socket: WebSocket | null = null
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let capture: AudioWorkletNode | null = null
  let seq = 0
  let revision = 0
  let final = false
  let stopped = false
  let flushing = false
  let reported = false
  let paused = false
  let reconnecting = false
  let doneControl: { kind: 'done'; requestId: string; lastSeq: number } | null = null
  let sentDone = false
  const unacknowledged = new Map<number, ArrayBuffer>()
  const sent = new Set<number>()

  const cleanup = () => {
    capture?.port.postMessage('stop')
    source?.disconnect()
    capture?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    void context?.close()
    capture = null
    source = null
    stream = null
    context = null
  }
  const fail = (message: string) => {
    if (reported || final || stopped) return
    reported = true
    cleanup()
    socket?.close()
    onStatus('')
    onError(`${message}. The partial transcript is still editable; continue in text.`)
  }
  const flush = () => {
    if (socket?.readyState !== WebSocket.OPEN) return
    for (const [number, frame] of unacknowledged) {
      if (sent.size >= MAX_LIVE) break
      if (sent.has(number)) continue
      socket.send(frame)
      sent.add(number)
    }
    if (
      doneControl &&
      !sentDone &&
      [...unacknowledged.keys()].every((number) => sent.has(number))
    ) {
      socket.send(JSON.stringify(doneControl))
      sentDone = true
    }
  }
  const handle = (event: MessageEvent) => {
    let message: {
      kind: string
      seq?: number
      revision?: number
      text?: string
      final?: boolean
      detail?: string
    }
    try {
      message = JSON.parse(String(event.data))
    } catch {
      fail('Invalid streaming response')
      return
    }
    if (message.kind === 'ack' && typeof message.seq === 'number') {
      for (const key of unacknowledged.keys()) if (key <= message.seq) unacknowledged.delete(key)
      for (const key of sent) if (key <= message.seq) sent.delete(key)
      flush()
      return
    }
    if (
      message.kind === 'transcript' &&
      typeof message.revision === 'number' &&
      typeof message.text === 'string' &&
      message.revision > revision &&
      !final
    ) {
      revision = message.revision
      final = message.final === true
      onTranscript(message.text, final)
      if (final) cleanup()
      return
    }
    if (message.kind === 'error') fail(message.detail ?? 'Streaming ASR failed')
  }
  const connect = async (): Promise<void> => {
    const { ticket } = await api.voiceTicket(sessionId)
    if (stopped || reported) throw new Error('Speech was stopped')
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(
      `${scheme}//${location.host}/sessions/${encodeURIComponent(sessionId)}/voice`,
      `lh-voice.${ticket}`,
    )
    socket = current
    await new Promise<void>((resolve, reject) => {
      let connecting = true
      const timeout = setTimeout(() => {
        current.close()
        reject(new Error('Recognizer did not become ready'))
      }, 5_000)
      current.onmessage = (event) => {
        try {
          if (JSON.parse(String(event.data)).kind === 'ready') {
            if (connecting) {
              connecting = false
              clearTimeout(timeout)
              resolve()
            }
            return
          }
        } catch {
          /* handled by the normal listener */
        }
        handle(event)
      }
      current.onclose = () => {
        if (connecting) {
          clearTimeout(timeout)
          reject(new Error('Speech connection closed'))
        } else if (!final && !reported && !stopped && socket === current) {
          void recover()
        }
      }
      current.onerror = () => current.close()
    })
    sent.clear()
    sentDone = false
    flush()
  }
  const recover = async () => {
    if (reconnecting || stopped || reported || final) return
    reconnecting = true
    capture?.port.postMessage('pause')
    onStatus('Connection interrupted. Microphone paused while reconnecting; wait to speak.')
    const deadline = Date.now() + RECONNECT_MS
    while (Date.now() < deadline && !stopped && !reported && !final) {
      try {
        await connect()
        if (stopped || reported) return
        if (!paused && socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ kind: 'resume' }))
        while (unacknowledged.size >= MAX_LIVE && Date.now() < deadline && !final && !reported)
          await new Promise((resolve) => setTimeout(resolve, 50))
        if (unacknowledged.size >= MAX_LIVE) break
        reconnecting = false
        if (!paused && !flushing) capture?.port.postMessage('resume')
        onStatus('')
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    reconnecting = false
    if (!stopped) fail('Speech connection could not recover within ten seconds')
  }

  try {
    await connect()
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    context = new AudioContext()
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-worklet.js`)
    source = context.createMediaStreamSource(stream)
    capture = new AudioWorkletNode(context, 'levelhead-pcm-capture')
    capture.port.onmessage = (event) => {
      if (stopped || reported || final) return
      const pcm: unknown = event.data
      if (typeof pcm === 'object' && pcm !== null && 'kind' in pcm && pcm.kind === 'flushed') {
        if (seq === 0) {
          fail('No audio frames were captured')
          return
        }
        doneControl = { kind: 'done', requestId: crypto.randomUUID(), lastSeq: seq - 1 }
        flush()
        return
      }
      if (!(pcm instanceof ArrayBuffer) || pcm.byteLength !== FRAME_BYTES) {
        fail('Microphone produced an invalid frame')
        return
      }
      const cap = reconnecting ? MAX_RECOVERY : MAX_LIVE
      if (
        unacknowledged.size >= cap ||
        (!reconnecting && socket!.bufferedAmount >= MAX_LIVE * (FRAME_BYTES + 4))
      ) {
        capture?.port.postMessage('pause')
        fail(
          reconnecting
            ? 'Audio recovery limit exceeded ten seconds'
            : 'Audio backlog exceeded two seconds',
        )
        return
      }
      const frame = new ArrayBuffer(FRAME_BYTES + 4)
      new DataView(frame).setUint32(0, seq, true)
      new Uint8Array(frame, 4).set(new Uint8Array(pcm))
      unacknowledged.set(seq, frame)
      seq += 1
      flush()
    }
    source.connect(capture)
    capture.connect(context.destination)
    await context.resume()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    throw error
  }
  return {
    done() {
      if (stopped || flushing || reported) return
      flushing = true
      capture?.port.postMessage('done')
    },
    pause() {
      paused = true
      capture?.port.postMessage('pause')
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'pause' }))
    },
    resume() {
      paused = false
      if (!reconnecting) capture?.port.postMessage('resume')
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'resume' }))
    },
    stop() {
      stopped = true
      cleanup()
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'stop' }))
      socket?.close()
    },
  }
}
