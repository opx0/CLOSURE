import { expect, spyOn, test } from 'bun:test'
import { api } from '../api/client.ts'
import { startLiveSpeech } from './live-speech.ts'

test('a dropped browser socket retries one pending frame and waits for a final transcript', async () => {
  const originals = new Map<string, PropertyDescriptor | undefined>()
  const replace = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  class Socket {
    static readonly OPEN = 1
    static readonly instances: Socket[] = []
    readyState = 0
    bufferedAmount = 0
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    readonly sent: unknown[] = []
    constructor() {
      Socket.instances.push(this)
      queueMicrotask(() => {
        this.readyState = 1
        this.onmessage?.({ data: JSON.stringify({ kind: 'ready' }) } as MessageEvent)
      })
    }
    send(data: unknown) {
      this.sent.push(data)
      if (data instanceof ArrayBuffer) {
        if (Socket.instances[0] === this) queueMicrotask(() => this.close())
        else
          queueMicrotask(() =>
            this.onmessage?.({ data: JSON.stringify({ kind: 'ack', seq: 0 }) } as MessageEvent),
          )
      } else if (JSON.parse(String(data)).kind === 'done') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: JSON.stringify({
              kind: 'transcript',
              revision: 1,
              text: 'recovered spoken answer',
              final: true,
            }),
          } as MessageEvent),
        )
      }
    }
    close() {
      if (this.readyState === 3) return
      this.readyState = 3
      queueMicrotask(() => this.onclose?.())
    }
  }
  class Context {
    audioWorklet = { addModule: async () => {} }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} }
    }
    async resume() {}
    async close() {}
    get destination() {
      return {}
    }
  }
  class Worklet {
    static instance: Worklet
    port = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (message: unknown) => {
        if (message === 'done')
          queueMicrotask(() => this.port.onmessage?.({ data: { kind: 'flushed' } } as MessageEvent))
      },
    }
    constructor() {
      Worklet.instance = this
    }
    connect() {}
    disconnect() {}
  }
  replace('location', { protocol: 'http:', host: '127.0.0.1:3097' })
  replace('WebSocket', Socket)
  replace('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } })
  replace('AudioContext', Context)
  replace('AudioWorkletNode', Worklet)
  const tickets = spyOn(api, 'voiceTicket').mockImplementation(async () => ({
    ticket: 'a'.repeat(64),
    attemptId: 'attempt_1',
    expiresAt: new Date().toISOString(),
  }))
  const statuses: string[] = []
  const errors: string[] = []
  try {
    let finish: (text: string) => void = () => {}
    const final = new Promise<string>((resolve) => (finish = resolve))
    const speech = await startLiveSpeech(
      'session_1',
      (text, accepted) => {
        if (accepted) finish(text)
      },
      (message) => errors.push(message),
      (message) => statuses.push(message),
    )
    Worklet.instance.port.onmessage?.({ data: new ArrayBuffer(3200) } as MessageEvent)
    for (let attempt = 0; Socket.instances.length < 2 && attempt < 30; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(Socket.instances).toHaveLength(2)
    speech.done()
    expect(
      await Promise.race([
        final,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('no final')), 1_000)),
      ]),
    ).toBe('recovered spoken answer')
    expect(tickets).toHaveBeenCalledTimes(2)
    expect(Socket.instances[0]!.sent.filter((item) => item instanceof ArrayBuffer)).toHaveLength(1)
    expect(Socket.instances[1]!.sent.filter((item) => item instanceof ArrayBuffer)).toHaveLength(1)
    expect(statuses.some((message) => message.includes('Microphone paused'))).toBe(true)
    expect(errors).toEqual([])
    speech.stop()
  } finally {
    tickets.mockRestore()
    for (const [name, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  }
})
