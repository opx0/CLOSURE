import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replay, silentLogger } from '@levelhead/core'
import { JsonlEventStore } from '../../../cli/src/store/jsonl.ts'
import { RandomIds, SystemClock } from '../../../cli/src/runtime.ts'
import { ScriptedConductor, ScriptedEvaluator } from '../../../cli/src/testing/fakes.ts'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'

const draft = {
  previousRevision: 0,
  title: 'Notification service',
  requirements: 'Deliver notifications with retries and deduplication.',
  estimates: '100 requests per second, 24 hour retention.',
  api: 'POST /notifications with an idempotency key.',
  dataModel: 'notification(id, recipient, state)',
  diagram: 'flowchart LR\n  API --> Queue --> Worker',
  constraint: 'One region is enough.',
}
const answer = 'I use an idempotency key so retried sends do not duplicate delivery.'
const finding = {
  findings: [
    {
      kind: 'competency',
      competency: 'trade_offs',
      levelMet: 'junior',
      rationale: 'Explains the trade-off.',
      confidence: 0.8,
      quotes: [answer],
    },
  ],
}

test('design revisions pin exact source to distinct interview evidence and reopen after a server restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-design-'))
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    LEVELHEAD_EVENT_DIR: root,
    LEVELHEAD_API_TOKENS: 'alice:alice-token,bob:bob-token',
  })
  const make = () =>
    buildApp(config, {
      storeFor: (owner) =>
        new JsonlEventStore(root, typeof owner === 'string' ? owner : owner.ownerId),
      clock: new SystemClock(),
      ids: new RandomIds(),
      conductor: new ScriptedConductor([
        'Explain your first design.',
        'What changes at twice the load?',
      ]),
      evaluator: new ScriptedEvaluator([finding, finding]),
      ceilings: { sessionCostUsd: 2, sessionTokens: 120000, modelCallsPerTurn: 3 },
      logger: silentLogger,
      queue: null,
      retrieval: null,
    })
  const first = await make()
  let second: Awaited<ReturnType<typeof make>> | undefined
  const auth = { authorization: 'Bearer alice-token' }
  try {
    const saved = await first.inject({
      method: 'POST',
      url: '/designs',
      headers: auth,
      payload: draft,
    })
    expect(saved.statusCode).toBe(200)
    const original = saved.json()
    expect(original.revision).toBe(1)
    expect(
      (
        await first.inject({ url: '/designs', headers: { authorization: 'Bearer bob-token' } })
      ).json().designs,
    ).toEqual([])
    const revised = await first.inject({
      method: 'POST',
      url: '/designs',
      headers: auth,
      payload: {
        ...draft,
        id: original.id,
        previousRevision: 1,
        constraint: 'A second region must survive the first region failing.',
      },
    })
    expect(revised.statusCode).toBe(200)
    expect(revised.json().revision).toBe(2)
    expect(
      (
        await first.inject({
          method: 'POST',
          url: '/designs',
          headers: auth,
          payload: { ...draft, id: original.id, previousRevision: 1 },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await first.inject({
          method: 'POST',
          url: '/sessions',
          headers: { authorization: 'Bearer bob-token' },
          payload: {
            mode: 'coach',
            rounds: ['system_design'],
            designId: original.id,
            designRevision: 1,
          },
        })
      ).statusCode,
    ).toBe(400)

    const sessions: string[] = []
    for (const version of [1, 2]) {
      const started = await first.inject({
        method: 'POST',
        url: '/sessions',
        headers: auth,
        payload: {
          mode: 'coach',
          rounds: ['system_design'],
          turnsPerRound: 1,
          drill: false,
          designId: original.id,
          designRevision: version,
        },
      })
      expect(started.statusCode).toBe(201)
      const id = started.json().sessionId as string
      sessions.push(id)
      expect(
        (
          await first.inject({
            method: 'POST',
            url: `/sessions/${id}/answers`,
            headers: auth,
            payload: { text: answer },
          })
        ).statusCode,
      ).toBe(200)
      const events = await new JsonlEventStore(root, 'alice').read(id)
      const question = events.find((event) => event.kind === 'question')
      expect(question?.payload).toMatchObject({ designId: original.id, designRevision: version })
      const view = replay(events)
      expect(view.session?.design?.constraint).toBe(
        version === 1 ? draft.constraint : revised.json().constraint,
      )
      expect(view.findings).toHaveLength(1)
      expect(
        (await first.inject({ url: `/sessions/${id}/debrief`, headers: auth })).statusCode,
      ).toBe(200)
    }
    await first.close()
    second = await make()
    for (const [at, id] of sessions.entries()) {
      const view = (await second.inject({ url: `/sessions/${id}`, headers: auth })).json()
      expect(view.availability).toBe('closed')
      expect(view.session.design.revision).toBe(at + 1)
      expect(view.findings).toHaveLength(1)
    }
    expect((await second.inject({ url: '/designs', headers: auth })).json().designs).toHaveLength(2)
  } finally {
    await second?.close()
    await first.close()
    await rm(root, { recursive: true, force: true })
  }
})
