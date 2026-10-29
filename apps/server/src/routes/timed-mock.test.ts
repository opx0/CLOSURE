import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replay, type Clock } from '@levelhead/core'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { JsonlEventStore } from '../../../cli/src/store/jsonl.ts'
import { RandomIds, SystemClock } from '../../../cli/src/runtime.ts'
import { ScriptedConductor, ScriptedEvaluator } from '../../../cli/src/testing/fakes.ts'
import { silentLogger } from '@levelhead/core'
import { testApi } from '../testing/harness.ts'

const answer = 'A B-tree index speeds reads but adds write and storage cost.'
const finding = {
  findings: [
    {
      kind: 'competency',
      competency: 'mechanism',
      levelMet: 'junior',
      confidence: 0.8,
      rationale: 'Explains the mechanism.',
      quotes: [answer],
    },
  ],
}

test('timed Simulation persists its policy and two rounds; no future-round feedback leaks', async () => {
  const { app, store } = await testApi({
    questions: ['Explain indexing.', 'Explain a search algorithm.'],
    scripted: [finding, finding],
  })
  try {
    const start = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        mode: 'simulation',
        rounds: ['cs_fundamentals', 'problem_solving'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 90 },
      },
    })
    expect(start.statusCode).toBe(201)
    const opened = start.json() as {
      sessionId: string
      deadlineAt: string
      round: { index: number }
    }
    expect(opened.deadlineAt).toBeTruthy()
    expect(opened.round.index).toBe(0)
    const first = await app.inject({
      method: 'POST',
      url: `/sessions/${opened.sessionId}/answers`,
      payload: { text: answer },
    })
    expect(first.statusCode).toBe(200)
    const next = first.json() as {
      status: string
      deadlineAt: string
      round: { index: number }
      findings: unknown[]
    }
    expect(next.status).toBe('awaiting_answer')
    expect(next.round.index).toBe(1)
    expect(next.deadlineAt).toBeTruthy()
    expect(next.findings).toHaveLength(1) // first round only
    const saved = replay(await store.read(opened.sessionId))
    expect(saved.session?.timing).toEqual({ answerSeconds: 90, turnsPerRound: 1 })
    expect(saved.closed).toBeNull()
    const second = await app.inject({
      method: 'POST',
      url: `/sessions/${opened.sessionId}/answers`,
      payload: { text: answer },
    })
    expect(second.json().status).toBe('closed')
    expect(second.json().findings).toHaveLength(1)
    const reopened = (await app.inject(`/sessions/${opened.sessionId}`)).json()
    expect(reopened.session.timing).toEqual(saved.session?.timing)
    expect(reopened.closed.reason).toBe('turns')
    expect(
      (await store.read(opened.sessionId)).filter(
        (event) => event.kind === 'state_change' && event.payload.change === 'round_started',
      ),
    ).toHaveLength(2)
  } finally {
    await app.close()
  }
})

test('expired answer closes explicitly and is never graded or accepted later', async () => {
  let current = Date.parse('2026-10-29T09:00:00Z')
  const clock: Clock = { now: () => new Date(current).toISOString() }
  const { app, store } = await testApi({ clock, questions: ['Explain indexing.'] })
  try {
    const start = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        mode: 'simulation',
        rounds: ['cs_fundamentals', 'problem_solving'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 10 },
      },
    })
    const id = start.json().sessionId as string
    current += 11_000
    const late = await app.inject({
      method: 'POST',
      url: `/sessions/${id}/answers`,
      payload: { text: answer },
    })
    expect(late.statusCode).toBe(200)
    expect(late.json().stoppedBy).toBe('timeout')
    const view = replay(await store.read(id))
    expect(view.transcript.filter((turn) => turn.role === 'candidate')).toEqual([])
    expect(view.findings).toEqual([])
    expect(view.closed?.reason).toBe('timeout')
    expect(
      (await store.read(id)).some(
        (event) => event.kind === 'state_change' && event.payload.change === 'answer_timed_out',
      ),
    ).toBe(true)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${id}/answers`,
          payload: { text: answer },
        })
      ).statusCode,
    ).toBe(409)
  } finally {
    await app.close()
  }
})

test('pause preserves remaining time, resume writes a fresh deadline, and Stop keeps history ungraded', async () => {
  let current = Date.parse('2026-10-29T09:00:00Z')
  const clock: Clock = { now: () => new Date(current).toISOString() }
  const { app, store } = await testApi({
    clock,
    questions: ['Explain indexing.'],
    scripted: [finding],
  })
  try {
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        mode: 'simulation',
        rounds: ['cs_fundamentals'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 30 },
      },
    })
    const id = started.json().sessionId as string
    const firstDeadline = started.json().deadlineAt as string
    current += 5_000
    const pause = await app.inject({
      method: 'POST',
      url: `/sessions/${id}/timing`,
      payload: { action: 'pause' },
    })
    expect(pause.json<{ paused: boolean; remainingMs: number }>()).toEqual({
      paused: true,
      remainingMs: 25_000,
    })
    expect((await app.inject(`/sessions/${id}`)).json()).toMatchObject({ timingPaused: true })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${id}/answers`,
          payload: { text: answer },
        })
      ).statusCode,
    ).toBe(409)
    current += 60_000
    const resumed = await app.inject({
      method: 'POST',
      url: `/sessions/${id}/timing`,
      payload: { action: 'resume' },
    })
    expect(resumed.statusCode).toBe(200)
    expect(Date.parse(resumed.json().deadlineAt)).toBe(current + 25_000)
    expect(resumed.json().deadlineAt).not.toBe(firstDeadline)
    expect((await app.inject(`/sessions/${id}`)).json().deadlineAt).toBe(resumed.json().deadlineAt)
    const stopped = await app.inject({ method: 'POST', url: `/sessions/${id}/stop` })
    expect(stopped.json()).toMatchObject({ status: 'closed', stoppedBy: 'stopped' })
    const view = replay(await store.read(id))
    expect(view.transcript.filter((turn) => turn.role === 'candidate')).toEqual([])
    expect(view.findings).toEqual([])
    expect(view.closed?.reason).toBe('stopped')
    expect(
      (await store.read(id)).filter(
        (event) => event.kind === 'state_change' && event.payload.change === 'answer_deadline',
      ),
    ).toHaveLength(2)
  } finally {
    await app.close()
  }
})

test('an unattended timed mock closes on the timer without an answer request', async () => {
  const { app, store } = await testApi({ questions: ['Explain indexing.'] })
  try {
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        mode: 'simulation',
        rounds: ['cs_fundamentals'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 10 },
      },
    })
    const id = started.json().sessionId as string
    const until = Date.now() + 12_000
    while (Date.now() < until && replay(await store.read(id)).closed === null)
      await new Promise((resolve) => setTimeout(resolve, 50))
    expect(replay(await store.read(id)).closed?.reason).toBe('timeout')
    expect(replay(await store.read(id)).findings).toEqual([])
  } finally {
    await app.close()
  }
}, 15_000)

test('a closed timed mock reopens from a fresh server over its JSONL history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-timed-restart-'))
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', LEVELHEAD_EVENT_DIR: root })
  const make = () =>
    buildApp(config, {
      storeFor: () => new JsonlEventStore(root, 'owner'),
      clock: new SystemClock(),
      ids: new RandomIds(),
      conductor: new ScriptedConductor(['Explain indexing.']),
      evaluator: new ScriptedEvaluator([]),
      ceilings: { sessionCostUsd: 2, sessionTokens: 120000, modelCallsPerTurn: 3 },
      logger: silentLogger,
      queue: null,
      retrieval: null,
    })
  const first = await make()
  let reopened: Awaited<ReturnType<typeof make>> | undefined
  try {
    const started = await first.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        mode: 'simulation',
        rounds: ['cs_fundamentals'],
        turnsPerRound: 1,
        drill: false,
        timedMock: { answerSeconds: 90 },
      },
    })
    const id = started.json().sessionId as string
    expect((await first.inject({ method: 'POST', url: `/sessions/${id}/stop` })).statusCode).toBe(
      200,
    )
    await first.close()
    reopened = await make()
    const view = (await reopened.inject(`/sessions/${id}`)).json()
    expect(view.availability).toBe('closed')
    expect(view.session.timing).toEqual({ answerSeconds: 90, turnsPerRound: 1 })
    expect(view.closed.reason).toBe('stopped')
    expect(view.transcript.filter((entry: { role: string }) => entry.role === 'candidate')).toEqual(
      [],
    )
    expect(
      (await reopened.inject(`/sessions/${id}/events`))
        .json()
        .some(
          (event: { kind: string; payload: { change?: string } }) =>
            event.kind === 'state_change' && event.payload.change === 'answer_stopped',
        ),
    ).toBe(true)
  } finally {
    await reopened?.close()
    await first.close()
    await rm(root, { recursive: true, force: true })
  }
})
