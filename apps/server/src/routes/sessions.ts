import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import {
  ClaimSchema,
  EventSchema,
  EvidenceSchema,
  FindingSchema,
  GapEntrySchema,
  LevelSchema,
  ModeSchema,
  PersonaIdSchema,
  PolicyActionSchema,
  PressureLevelSchema,
  RoundKindSchema,
  SessionSchema,
  SessionStateSchema,
  SpanSchema,
  InvocationRecordSchema,
} from '@closer/contracts'
import type { Level, Mode, PersonaId, RoundKind } from '@closer/contracts'
import { replay } from '@closer/core'
import type { PressureLevel } from '@closer/core'
import { CLAIM_SET_SESSION } from '../../../cli/src/commands/claims.ts'
import type { ServerDeps } from '../deps.ts'
import type { SessionHost } from '../session-host.ts'
import {
  ErrorSchema,
  QuotedEvidenceSchema,
  SessionIdParamsSchema,
  quotesFrom,
  wireFindings,
} from './shared.ts'

// No score and no quality summary here — findings and their citations are the whole output, as in
// the terminal.
const TurnUpdateSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal('awaiting_answer'), Type.Literal('closed')]),
  round: Type.Optional(
    Type.Object({
      kind: RoundKindSchema,
      index: Type.Integer({ minimum: 0 }),
      total: Type.Integer({ minimum: 1 }),
      brief: Type.Optional(Type.String()),
    }),
  ),
  question: Type.Optional(
    Type.Object({
      text: Type.String({ minLength: 1 }),
      turn: Type.Integer({ minimum: 0 }),
      // Chosen by code, never the model — the candidate is owed why a question was asked this way.
      action: PolicyActionSchema,
      pressureLevel: PressureLevelSchema,
      round: RoundKindSchema,
    }),
  ),
  findings: Type.Array(FindingSchema),
  quotes: Type.Array(QuotedEvidenceSchema),
  notices: Type.Array(Type.String()),
  stoppedBy: Type.Optional(
    Type.Union([
      Type.Literal('turns'),
      Type.Literal('end_topic'),
      Type.Literal('ceiling'),
      Type.Literal('evaluator_failure'),
    ]),
  ),
})

const SessionViewSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  session: Type.Union([SessionSchema, Type.Null()]),
  state: SessionStateSchema,
  round: Type.Union([RoundKindSchema, Type.Null()]),
  pressureLevel: PressureLevelSchema,
  transcript: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal('interviewer'), Type.Literal('candidate')]),
      text: Type.String(),
      attemptId: Type.String({ minLength: 1 }),
    }),
  ),
  findings: Type.Array(FindingSchema),
  quotes: Type.Array(QuotedEvidenceSchema),
  gaps: Type.Array(GapEntrySchema),
  claims: Type.Array(ClaimSchema),
  spans: Type.Array(SpanSchema),
  evidence: Type.Array(EvidenceSchema),
  invocations: Type.Array(InvocationRecordSchema),
  // Cost and tokens so the caller can check a ceiling promise — not a quality number.
  totals: Type.Object({ costUsd: Type.Number(), tokens: Type.Number() }),
  closed: Type.Union([Type.Object({ reason: Type.String() }), Type.Null()]),
})

export function sessionRoutes(deps: ServerDeps, host: SessionHost): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post(
      '/sessions',
      {
        schema: {
          summary: 'Start an interview over the confirmed claim set and return the first question',
          tags: ['sessions'],
          body: Type.Object({
            // Every default matches `closer session`'s, so both callers start the same interview.
            claimIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
            mode: Type.Optional(ModeSchema),
            level: Type.Optional(LevelSchema),
            personaId: Type.Optional(PersonaIdSchema),
            pressureCeiling: Type.Optional(PressureLevelSchema),
            rounds: Type.Optional(Type.Array(RoundKindSchema, { minItems: 1 })),
            turnsPerRound: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
            drill: Type.Optional(Type.Boolean()),
          }),
          response: { 201: TurnUpdateSchema, 400: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const store = deps.storeFor(request.principal)
        const claimSet = replay(await store.read(CLAIM_SET_SESSION))
        const confirmed = [...claimSet.claims.values()].filter((claim) =>
          claimSet.confirmedClaimIds.has(claim.id),
        )
        if (confirmed.length === 0) {
          return reply.code(409).send({
            error: 'no confirmed claims',
            detail: 'POST /claims, then POST /claims/:id/confirm — §4.1: nothing starts confirmed',
          })
        }

        const wanted = request.body.claimIds
        const claims =
          wanted === undefined ? confirmed : confirmed.filter((claim) => wanted.includes(claim.id))
        if (wanted !== undefined && claims.length !== wanted.length) {
          const missing = wanted.filter((id) => !claims.some((claim) => claim.id === id))
          return reply.code(400).send({
            error: 'claim is not confirmed, or does not exist',
            detail: missing.join(', '),
          })
        }

        const rounds = (request.body.rounds ?? ['project_deep_dive']) as RoundKind[]
        // Walkthrough needs a pinned snapshot, which this API can't create — refused rather than
        // degraded into a generic question wearing a citation.
        if (rounds.includes('code_walkthrough')) {
          return reply.code(400).send({
            error: 'a code walkthrough needs a pinned repository',
            detail: 'pin one with `closer repo <path>`; this API does not pin snapshots',
          })
        }

        const update = await host.start({
          principal: request.principal,
          claims,
          rounds,
          mode: (request.body.mode ?? 'simulation') as Mode,
          level: (request.body.level ?? 'mid') as Level,
          personaId: (request.body.personaId ?? 'skeptic') as PersonaId,
          pressureCeiling: (request.body.pressureCeiling ?? 3) as PressureLevel,
          turnsPerRound: request.body.turnsPerRound ?? 6,
          drill: request.body.drill ?? true,
        })
        return reply.code(201).send({ ...update, findings: wireFindings(update.findings) })
      },
    )

    app.post(
      '/sessions/:id/answers',
      {
        schema: {
          summary: 'Submit one answer and receive the next question and any findings',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          body: Type.Object({ text: Type.String() }),
          response: { 200: TurnUpdateSchema, 404: ErrorSchema, 409: ErrorSchema },
        },
      },
      async (request, reply) => {
        const sessionId = request.params.id
        const live = host.get(sessionId, request.principal.ownerId)
        if (live === undefined) {
          // The log outlives the process; the suspended loop doesn't — distinguishes "no such
          // interview" (404) from "not resumable here" (409).
          const events = await deps.storeFor(request.principal).read(sessionId)
          if (events.length === 0) {
            return reply.code(404).send({ error: 'no such session', detail: sessionId })
          }
          return reply.code(409).send({
            error: 'session is not in progress on this server',
            detail: 'its log is still readable at GET /sessions/:id',
          })
        }
        if (!live.awaitingAnswer) {
          return reply.code(409).send({ error: 'session is not waiting for an answer' })
        }
        const update = await live.submit(request.body.text)
        return { ...update, findings: wireFindings(update.findings) }
      },
    )

    app.get(
      '/sessions/:id',
      {
        schema: {
          summary: 'The session as replayed from its event log',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: { 200: SessionViewSchema, 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }

        // Nothing added beyond the log's own fold — same view the CLI prints from, maps flattened.
        const view = replay(events)
        return {
          sessionId: view.sessionId,
          session: view.session,
          state: view.state,
          round: view.round,
          pressureLevel: view.pressureLevel,
          transcript: [...view.transcript],
          findings: wireFindings(view.findings),
          quotes: quotesFrom(view),
          gaps: [...view.gaps.values()],
          claims: [...view.claims.values()],
          spans: [...view.spans.values()],
          evidence: [...view.evidence.values()],
          invocations: [...view.invocations],
          totals: view.totals,
          closed: view.closed,
        }
      },
    )

    app.get(
      '/sessions/:id/events',
      {
        schema: {
          summary: 'The raw append-only event log, in seq order',
          tags: ['sessions'],
          params: SessionIdParamsSchema,
          response: { 200: Type.Array(EventSchema), 404: ErrorSchema },
        },
      },
      async (request, reply) => {
        const events = await deps.storeFor(request.principal).read(request.params.id)
        if (events.length === 0) {
          return reply.code(404).send({ error: 'no such session', detail: request.params.id })
        }
        return events
      },
    )
  }
}
