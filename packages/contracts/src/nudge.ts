import { Type, type Static } from '@sinclair/typebox'

export const NudgeChannelSchema = Type.Union([
  Type.Literal('email'),
  Type.Literal('sms'),
  Type.Literal('whatsapp'),
])
export type NudgeChannel = Static<typeof NudgeChannelSchema>

// A message to the candidate about their own due practice. It carries the gap ids it was raised
// from so the body can never be written about work that is not actually due.
export const NudgeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  channel: NudgeChannelSchema,
  to: Type.String({ minLength: 1 }),
  subject: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  body: Type.String({ minLength: 1 }),
  dueAt: Type.String({ format: 'date-time' }),
  gapIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
})
export type Nudge = Static<typeof NudgeSchema>

export const NudgeDeliverySchema = Type.Object({
  nudgeId: Type.String({ minLength: 1 }),
  channel: NudgeChannelSchema,
  // `dry_run` is the default outcome. Sending for real needs the adapter configured and the arming
  // flag set, so an unconfigured install renders every message and delivers none.
  outcome: Type.Union([
    Type.Literal('dry_run'),
    Type.Literal('sent'),
    Type.Literal('rejected_by_provider'),
  ]),
  at: Type.String({ format: 'date-time' }),
  providerRef: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  detail: Type.Union([Type.String(), Type.Null()]),
})
export type NudgeDelivery = Static<typeof NudgeDeliverySchema>
