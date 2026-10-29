import { randomBytes } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyRequest } from 'fastify'
import type { WebSocket as BrowserSocket } from 'ws'
import {
  VoiceClientMessageSchema,
  VoiceServerMessageSchema,
  VOICE_FRAME_HEADER_BYTES,
  VOICE_LIVE_FRAMES,
  VOICE_PCM_BYTES_PER_FRAME,
  type Principal,
  type VoiceClientMessage,
  type VoiceServerMessage,
} from '@levelhead/contracts'
import { replay, VoiceFrameQueue, VoiceTranscript } from '@levelhead/core'
import type { Config } from '../config.ts'
import type { ServerDeps } from '../deps.ts'
import type { SessionHost } from '../session-host.ts'
import { ErrorSchema, SessionIdParamsSchema } from './shared.ts'

const TICKET_MS = 30_000
const FINAL_MS = 10_000
const RECONNECT_MS = 10_000
const FRAME_BYTES = VOICE_FRAME_HEADER_BYTES + VOICE_PCM_BYTES_PER_FRAME

interface Ticket {
  principal: Principal
  sessionId: string
  attemptId: string
  expires: number
}

function permittedOrigin(
  origin: string | undefined,
  host: string | undefined,
  config: Config,
): boolean {
  if (!origin || !host) return false
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false
    return parsed.host === host || config.LEVELHEAD_CORS_ORIGIN.split(',').includes(origin)
  } catch {
    return false
  }
}

function sidecarUrl(config: Config): string | null {
  if (!config.VOICE_STREAM_TOKEN) return null
  try {
    const url = new URL(config.VOICE_STREAM_URL)
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.toString()
  } catch {
    return null
  }
}

export function voiceRoutes(
  deps: ServerDeps,
  host: SessionHost,
  config: Config,
): FastifyPluginAsyncTypebox {
  const issued = new Map<string, Ticket>()
  const upgraded = new WeakMap<FastifyRequest, Ticket>()
  const active = new Map<string, { attached: boolean; attach: (socket: BrowserSocket) => void }>()
  const url = sidecarUrl(config)
  return async (app) => {
    app.post(
      '/sessions/:id/voice-ticket',
      {
        schema: {
          tags: ['voice'],
          params: SessionIdParamsSchema,
          response: {
            200: Type.Object({
              ticket: Type.String(),
              attemptId: Type.String(),
              expiresAt: Type.String(),
            }),
            404: ErrorSchema,
            409: ErrorSchema,
            503: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (url === null)
          return reply.code(503).send({ error: 'local streaming ASR is not configured' })
        const live = host.get(request.params.id, request.principal.ownerId)
        if (!live?.awaitingAnswer)
          return reply.code(404).send({ error: 'no answerable session for this owner' })
        const view = replay(await deps.storeFor(request.principal).read(request.params.id))
        const attemptId = [...view.transcript]
          .reverse()
          .find((turn) => turn.role === 'interviewer')?.attemptId
        if (
          !attemptId ||
          view.transcript.some((turn) => turn.role === 'candidate' && turn.attemptId === attemptId)
        )
          return reply.code(409).send({ error: 'no unanswered question available' })
        const key = `${request.principal.ownerId}:${request.params.id}:${attemptId}`
        if (active.get(key)?.attached)
          return reply.code(409).send({ error: 'voice already active for this question' })
        for (const [token, ticket] of issued)
          if (
            ticket.expires < Date.now() ||
            (ticket.principal.ownerId === request.principal.ownerId &&
              ticket.sessionId === request.params.id)
          )
            issued.delete(token)
        const ticket = randomBytes(32).toString('hex')
        const expires = Date.now() + TICKET_MS
        issued.set(ticket, {
          principal: request.principal,
          sessionId: request.params.id,
          attemptId,
          expires,
        })
        reply.header('cache-control', 'no-store')
        return { ticket, attemptId, expiresAt: new Date(expires).toISOString() }
      },
    )

    app.get(
      '/sessions/:id/voice',
      {
        websocket: true,
        schema: { hide: true, params: SessionIdParamsSchema },
        preValidation: async (request, reply) => {
          if (!permittedOrigin(request.headers.origin, request.headers.host, config))
            return reply.code(403).send({ error: 'origin not allowed' })
          const protocol = request.headers['sec-websocket-protocol']
          const token =
            typeof protocol === 'string' && /^lh-voice\.[a-f0-9]{64}$/.test(protocol)
              ? protocol.slice('lh-voice.'.length)
              : ''
          const ticket = issued.get(token)
          if (!ticket || ticket.expires < Date.now() || ticket.sessionId !== request.params.id)
            return reply.code(401).send({ error: 'invalid or expired voice ticket' })
          const key = `${ticket.principal.ownerId}:${ticket.sessionId}:${ticket.attemptId}`
          const live = host.get(ticket.sessionId, ticket.principal.ownerId)
          const view = replay(await deps.storeFor(ticket.principal).read(ticket.sessionId))
          const latest = [...view.transcript]
            .reverse()
            .find((turn) => turn.role === 'interviewer')?.attemptId
          if (
            !live?.awaitingAnswer ||
            latest !== ticket.attemptId ||
            view.transcript.some(
              (turn) => turn.role === 'candidate' && turn.attemptId === ticket.attemptId,
            ) ||
            active.get(key)?.attached
          )
            return reply.code(409).send({ error: 'voice question is no longer available' })
          issued.delete(token)
          request.principal = ticket.principal
          upgraded.set(request, ticket)
        },
      },
      (incoming, request) => {
        const ticket = upgraded.get(request)!
        const key = `${ticket.principal.ownerId}:${ticket.sessionId}:${ticket.attemptId}`
        const existing = active.get(key)
        if (existing) {
          existing.attach(incoming)
          return
        }
        const queue = new VoiceFrameQueue()
        const transcript = new VoiceTranscript()
        let socket: BrowserSocket | null = null
        let paused = false
        let resumeRequested = false
        let finished = false
        let pendingDone: Extract<VoiceClientMessage, { kind: 'done' }> | null = null
        let sentDone: Extract<VoiceClientMessage, { kind: 'done' }> | null = null
        let timer: ReturnType<typeof setTimeout> | null = null
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        const send = (message: VoiceServerMessage) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
        }
        const dispose = () => {
          if (timer !== null) clearTimeout(timer)
          if (reconnectTimer !== null) clearTimeout(reconnectTimer)
          queue.stop()
          sidecar.close()
          active.delete(key)
        }
        const fail = (
          code: Extract<VoiceServerMessage, { kind: 'error' }>['code'],
          detail: string,
        ) => {
          finished = true
          send({ kind: 'error', code, detail })
          if (socket?.readyState === WebSocket.OPEN) socket.close(1011, code)
          else dispose()
        }
        const sidecar = new WebSocket(url!, [`lh-sidecar.${config.VOICE_STREAM_TOKEN}`])
        sidecar.binaryType = 'arraybuffer'
        sidecar.addEventListener('open', () => send({ kind: 'ready' }))
        const finishIfReady = () => {
          if (pendingDone === null || sidecar.readyState !== WebSocket.OPEN) return
          if (!queue.finish(pendingDone.requestId, pendingDone.lastSeq)) return
          sidecar.send(JSON.stringify(pendingDone))
          sentDone = pendingDone
          pendingDone = null
        }
        sidecar.addEventListener('message', (event) => {
          let message: unknown
          try {
            message = JSON.parse(String(event.data))
          } catch {
            fail('finalization_failed', 'Invalid recognizer response')
            return
          }
          if (!Value.Check(VoiceServerMessageSchema, message)) {
            fail('finalization_failed', 'Invalid recognizer response')
            return
          }
          if (message.kind === 'ack') {
            const frame = queue.take()
            if (frame?.seq !== message.seq || queue.acknowledge(message.seq).kind !== 'ack') {
              fail('out_of_order', 'Recognizer acknowledged an unexpected frame')
              return
            }
            send(message)
            if (resumeRequested && queue.pending < VOICE_LIVE_FRAMES) paused = false
            finishIfReady()
          } else if (message.kind === 'transcript') {
            if (message.final && timer === null) return
            if (!transcript.revise(message)) return
            send(message)
            if (message.final) {
              finished = true
              if (socket?.readyState === WebSocket.OPEN) socket.close(1000)
            }
          } else if (message.kind === 'error') fail(message.code, message.detail)
        })
        sidecar.addEventListener('error', () =>
          fail('finalization_failed', 'Local recognizer unavailable'),
        )
        sidecar.addEventListener('close', () => {
          if (!finished) fail('finalization_failed', 'Local recognizer disconnected')
        })
        const onMessage = (data: Buffer, isBinary: boolean) => {
          if (isBinary) {
            if (sidecar.readyState !== WebSocket.OPEN) {
              send({ kind: 'error', code: 'not_ready', detail: 'Recognizer is starting' })
              return
            }
            const bytes = new Uint8Array(data)
            if (bytes.byteLength === FRAME_BYTES) {
              const seq = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)
              if (seq < queue.expectedSeq) {
                if (seq <= queue.acknowledgedSeq) send({ kind: 'ack', seq: queue.acknowledgedSeq })
                else if (queue.matchesPending(bytes)) send({ kind: 'queued', seq })
                else fail('out_of_order', 'Conflicting retransmitted audio')
                return
              }
            }
            if (paused) {
              send({
                kind: 'error',
                code: 'queue_full',
                detail: 'Audio paused; wait for recognizer',
              })
              return
            }
            if (sidecar.bufferedAmount + FRAME_BYTES > VOICE_LIVE_FRAMES * FRAME_BYTES) {
              paused = true
              send({
                kind: 'error',
                code: 'queue_full',
                detail: 'Recognizer backlog exceeded 2 seconds',
              })
              return
            }
            const accepted = queue.accept(bytes)
            if (accepted.kind === 'queued') sidecar.send(bytes)
            else send(accepted)
            if (accepted.kind === 'error' && accepted.code === 'queue_full') paused = true
            return
          }
          let message: unknown
          try {
            message = JSON.parse(String(data))
          } catch {
            fail('invalid_frame', 'Invalid voice control')
            return
          }
          if (!Value.Check(VoiceClientMessageSchema, message)) {
            fail('invalid_frame', 'Invalid voice control')
            return
          }
          if (message.kind === 'pause') {
            paused = true
            resumeRequested = false
          }
          if (message.kind === 'resume') {
            resumeRequested = true
            if (queue.pending < VOICE_LIVE_FRAMES) paused = false
          }
          if (message.kind === 'stop') {
            finished = true
            queue.stop()
            sidecar.close()
            socket?.close(1000)
          }
          if (message.kind === 'done') {
            if (sentDone !== null) {
              if (sentDone.requestId !== message.requestId || sentDone.lastSeq !== message.lastSeq)
                fail('out_of_order', 'Conflicting Done')
              return
            }
            if (
              pendingDone !== null &&
              (pendingDone.requestId !== message.requestId ||
                pendingDone.lastSeq !== message.lastSeq)
            ) {
              fail('out_of_order', 'Conflicting Done')
              return
            }
            pendingDone = message
            timer ??= setTimeout(
              () => fail('finalization_failed', 'Streaming ASR did not finalize'),
              FINAL_MS,
            )
            finishIfReady()
          }
        }
        const state = {
          attached: false,
          attach(next: BrowserSocket) {
            socket = next
            state.attached = true
            if (reconnectTimer !== null) clearTimeout(reconnectTimer)
            reconnectTimer = null
            next.on('message', onMessage)
            next.on('close', () => {
              if (socket !== next) return
              socket = null
              state.attached = false
              if (finished) dispose()
              else reconnectTimer = setTimeout(dispose, RECONNECT_MS)
            })
            if (sidecar.readyState === WebSocket.OPEN || transcript.acceptedText !== null) {
              send({ kind: 'ready' })
              if (queue.acknowledgedSeq >= 0) send({ kind: 'ack', seq: queue.acknowledgedSeq })
              const current = transcript.currentRevision
              if (current) send({ kind: 'transcript', ...current })
              if (finished) next.close(1000)
            }
          },
        }
        active.set(key, state)
        state.attach(incoming)
      },
    )
  }
}
