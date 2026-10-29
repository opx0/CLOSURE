import { expect, test } from 'bun:test'
import { WebSocket as ClientSocket, WebSocketServer } from 'ws'
import { VOICE_PCM_BYTES_PER_FRAME } from '@levelhead/contracts'
import { encodePcmFrame } from '@levelhead/core'
import { confirmedClaim, EXTRACTION, testApi } from '../testing/harness.ts'

const TOKEN = 'private-sidecar-token-123'

async function sidecar() {
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    handleProtocols: (protocols) =>
      protocols.has(`lh-sidecar.${TOKEN}`) ? `lh-sidecar.${TOKEN}` : false,
  })
  await new Promise<void>((resolve) => server.on('listening', resolve))
  server.on('connection', (socket) => {
    socket.on('message', (bytes, binary) => {
      if (binary) {
        const seq = (bytes as Buffer).readUInt32LE(0)
        socket.send(JSON.stringify({ kind: 'ack', seq }))
        socket.send(
          JSON.stringify({ kind: 'transcript', revision: 1, text: 'provisional', final: false }),
        )
      } else {
        const control = JSON.parse(String(bytes)) as { kind: string }
        if (control.kind === 'done')
          socket.send(
            JSON.stringify({ kind: 'transcript', revision: 2, text: 'final answer', final: true }),
          )
      }
    })
  })
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('sidecar did not listen')
  return { server, url: `ws://127.0.0.1:${address.port}` }
}

test('one-use ticket binds a live question; gateway waits for ack and explicit Done before final text', async () => {
  const recognizer = await sidecar()
  const { app } = await testApi({
    questions: ['Explain the queue.'],
    scripted: [EXTRACTION],
    config: { VOICE_STREAM_URL: recognizer.url, VOICE_STREAM_TOKEN: TOKEN },
  })
  let socket: ClientSocket | null = null
  try {
    await confirmedClaim(app)
    const start = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        rounds: ['project_deep_dive'],
        mode: 'coach',
        turnsPerRound: 1,
        drill: false,
      },
    })
    expect(start.statusCode).toBe(201)
    const sessionId = start.json<{ sessionId: string }>().sessionId
    const ticket = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/voice-ticket` })
    expect(ticket.statusCode).toBe(200)
    const secret = ticket.json<{ ticket: string; attemptId: string }>()
    expect(secret.ticket).toHaveLength(64)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('app did not listen')
    const origin = `http://127.0.0.1:${address.port}`
    const denied = new ClientSocket(
      `${origin.replace('http', 'ws')}/sessions/${sessionId}/voice`,
      [`lh-voice.${secret.ticket}`],
      { headers: { Origin: 'http://untrusted.invalid' } },
    )
    expect(
      await new Promise<number>((resolve) =>
        denied.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0)),
      ),
    ).toBe(403)
    socket = new ClientSocket(
      `${origin.replace('http', 'ws')}/sessions/${sessionId}/voice`,
      [`lh-voice.${secret.ticket}`],
      { headers: { Origin: origin } },
    )
    const opened = new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve)
      socket!.once('error', reject)
      socket!.once('unexpected-response', (_request, response) =>
        reject(new Error(`voice handshake ${response.statusCode}`)),
      )
    })
    await opened
    const messages: unknown[] = []
    const final = new Promise<{ text: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`no final transcript: ${JSON.stringify(messages)}`)),
        3_000,
      )
      socket!.on('message', (data) => {
        const message = JSON.parse(String(data)) as {
          kind: string
          seq?: number
          final?: boolean
          text: string
        }
        messages.push(message)
        if (message.kind === 'ready')
          socket!.send(encodePcmFrame({ seq: 0, pcm: new Uint8Array(VOICE_PCM_BYTES_PER_FRAME) }))
        if (message.kind === 'ack')
          socket!.send(JSON.stringify({ kind: 'done', requestId: 'done-1', lastSeq: message.seq }))
        if (message.kind === 'transcript' && message.final) {
          clearTimeout(timeout)
          resolve(message)
        }
      })
    })
    expect((await final).text).toBe('final answer')
    const replay = new ClientSocket(
      `${origin.replace('http', 'ws')}/sessions/${sessionId}/voice`,
      [`lh-voice.${secret.ticket}`],
      { headers: { Origin: origin } },
    )
    const status = await new Promise<number>((resolve) =>
      replay.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0)),
    )
    expect(status).toBe(401)
  } finally {
    socket?.close()
    await app.close()
    await new Promise<void>((resolve) => recognizer.server.close(() => resolve()))
  }
})

test('ticket issuance is scoped to the bearer owner and requires a live unanswered session', async () => {
  const { app } = await testApi({
    questions: ['Explain the index.'],
    config: {
      VOICE_STREAM_TOKEN: TOKEN,
      LEVELHEAD_API_TOKENS: 'alice:alice-token,bob:bob-token',
    },
  })
  try {
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { authorization: 'Bearer alice-token' },
      payload: { topicIds: ['dbms.indexes'], mode: 'coach', turnsPerRound: 1, drill: false },
    })
    expect(started.statusCode).toBe(201)
    const id = started.json<{ sessionId: string }>().sessionId
    expect(
      (await app.inject({ method: 'POST', url: `/sessions/${id}/voice-ticket` })).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${id}/voice-ticket`,
          headers: { authorization: 'Bearer bob-token' },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${id}/voice-ticket`,
          headers: { authorization: 'Bearer alice-token' },
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await app.close()
  }
})

test('a fresh ticket reattaches to the same recognizer stream and duplicate audio is not forwarded', async () => {
  let sidecarConnections = 0
  let sidecarFrames = 0
  const recognizer = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    handleProtocols: (protocols) =>
      protocols.has(`lh-sidecar.${TOKEN}`) ? `lh-sidecar.${TOKEN}` : false,
  })
  await new Promise<void>((resolve) => recognizer.once('listening', resolve))
  recognizer.on('connection', (peer) => {
    sidecarConnections += 1
    peer.on('message', (data, binary) => {
      if (binary) {
        sidecarFrames += 1
        setTimeout(
          () => peer.send(JSON.stringify({ kind: 'ack', seq: (data as Buffer).readUInt32LE(0) })),
          100,
        )
      } else if (JSON.parse(String(data)).kind === 'done') {
        peer.send(
          JSON.stringify({
            kind: 'transcript',
            revision: 1,
            text: 'recovered answer',
            final: true,
          }),
        )
      }
    })
  })
  const address = recognizer.address()
  if (typeof address === 'string' || address === null) throw new Error('sidecar did not listen')
  const { app } = await testApi({
    questions: ['Explain the queue.'],
    scripted: [EXTRACTION],
    config: {
      VOICE_STREAM_URL: `ws://127.0.0.1:${address.port}`,
      VOICE_STREAM_TOKEN: TOKEN,
    },
  })
  let first: ClientSocket | null = null
  let second: ClientSocket | null = null
  try {
    await confirmedClaim(app)
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { rounds: ['project_deep_dive'], mode: 'coach', turnsPerRound: 1, drill: false },
    })
    const id = started.json<{ sessionId: string }>().sessionId
    await app.listen({ host: '127.0.0.1', port: 0 })
    const listener = app.server.address()
    if (listener === null || typeof listener === 'string') throw new Error('app did not listen')
    const origin = `http://127.0.0.1:${listener.port}`
    const open = async (ticket: string) => {
      const client = new ClientSocket(
        `ws://127.0.0.1:${listener.port}/sessions/${id}/voice`,
        [`lh-voice.${ticket}`],
        { headers: { Origin: origin } },
      )
      client.on('error', () => {})
      const ready = new Promise<void>((resolve) => {
        client.on('message', (data) => {
          if (JSON.parse(String(data)).kind === 'ready') resolve()
        })
      })
      await new Promise<void>((resolve, reject) => {
        client.once('open', resolve)
        client.once('error', reject)
      })
      return { client, ready }
    }
    const ticket = async () =>
      (await app.inject({ method: 'POST', url: `/sessions/${id}/voice-ticket` })).json<{
        ticket: string
      }>().ticket
    const initial = await open(await ticket())
    first = initial.client
    await initial.ready
    const frame = encodePcmFrame({ seq: 0, pcm: new Uint8Array(VOICE_PCM_BYTES_PER_FRAME) })
    await new Promise<void>((resolve, reject) =>
      first!.send(frame, (error) => (error ? reject(error) : resolve())),
    )
    first.close()
    await new Promise<void>((resolve) => first!.once('close', () => resolve()))
    let nextTicket = ''
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: `/sessions/${id}/voice-ticket` })
      if (response.statusCode === 200) {
        nextTicket = response.json<{ ticket: string }>().ticket
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(nextTicket).not.toBe('')
    const resumed = await open(nextTicket)
    second = resumed.client
    const final = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no recovered final')), 3_000)
      second!.on('message', (data) => {
        const message = JSON.parse(String(data)) as { kind: string; seq?: number; text?: string }
        if (message.kind === 'ack')
          second!.send(JSON.stringify({ kind: 'done', requestId: 'recover-done', lastSeq: 0 }))
        if (message.kind === 'transcript') {
          clearTimeout(timeout)
          resolve(message.text ?? '')
        }
      })
    })
    await resumed.ready
    second.send(frame)
    expect(await final).toBe('recovered answer')
    expect(sidecarConnections).toBe(1)
    expect(sidecarFrames).toBe(1)
  } finally {
    first?.terminate()
    second?.terminate()
    await app.close()
    for (const client of recognizer.clients) client.terminate()
    await new Promise<void>((resolve) => recognizer.close(() => resolve()))
  }
})
