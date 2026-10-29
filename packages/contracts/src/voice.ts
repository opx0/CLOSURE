import { Type, type Static } from '@sinclair/typebox'

export const VOICE_SAMPLE_RATE = 16_000
export const VOICE_FRAME_MS = 100
export const VOICE_PCM_BYTES_PER_FRAME = (VOICE_SAMPLE_RATE * VOICE_FRAME_MS * 2) / 1_000
export const VOICE_FRAME_HEADER_BYTES = 4
export const VOICE_LIVE_FRAMES = 20
export const VOICE_RECOVERY_FRAMES = 100

// Binary frames carry a little-endian uint32 sequence followed by exactly 100 ms of
// mono signed PCM16. Control and transcript messages are JSON on the same WebSocket.
export const VoiceClientMessageSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('done'),
    requestId: Type.String({ minLength: 1 }),
    lastSeq: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({ kind: Type.Literal('pause') }),
  Type.Object({ kind: Type.Literal('resume') }),
  Type.Object({ kind: Type.Literal('stop') }),
])
export type VoiceClientMessage = Static<typeof VoiceClientMessageSchema>

export const VoiceServerMessageSchema = Type.Union([
  Type.Object({ kind: Type.Literal('ready') }),
  Type.Object({ kind: Type.Literal('queued'), seq: Type.Integer({ minimum: 0 }) }),
  Type.Object({ kind: Type.Literal('ack'), seq: Type.Integer({ minimum: 0 }) }),
  Type.Object({
    kind: Type.Literal('transcript'),
    revision: Type.Integer({ minimum: 1 }),
    text: Type.String(),
    final: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal('error'),
    code: Type.Union([
      Type.Literal('invalid_frame'),
      Type.Literal('out_of_order'),
      Type.Literal('queue_full'),
      Type.Literal('not_ready'),
      Type.Literal('finalization_failed'),
      Type.Literal('stopped'),
    ]),
    detail: Type.String(),
  }),
])
export type VoiceServerMessage = Static<typeof VoiceServerMessageSchema>
