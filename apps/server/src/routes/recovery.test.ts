import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replay, silentLogger } from '@levelhead/core'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config.ts'
import { JsonlEventStore } from '../../../cli/src/store/jsonl.ts'
import { RandomIds, SystemClock } from '../../../cli/src/runtime.ts'
import { ScriptedConductor, ScriptedEvaluator } from '../../../cli/src/testing/fakes.ts'

test('a fresh server over persistent events exposes an interrupted interview and closes it once without losing or grading work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'levelhead-recovery-'))
  const text = 'A B-tree stores ordered keys and updates them on inserts.'
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    LEVELHEAD_API_TOKENS: 'alice:alice-test,bob:bob-test',
  })
  const alice = { authorization: 'Bearer alice-test' }
  const store = new JsonlEventStore(root, 'alice')
  const deps = {
    storeFor: (owner: string | { ownerId: string }) =>
      new JsonlEventStore(root, typeof owner === 'string' ? owner : owner.ownerId),
    clock: new SystemClock(),
    ids: new RandomIds(),
    conductor: new ScriptedConductor(['Explain an index.', 'What changes on a write?']),
    evaluator: new ScriptedEvaluator([
      {
        findings: [
          {
            kind: 'competency',
            competency: 'mechanism',
            levelMet: 'junior',
            confidence: 0.8,
            rationale: 'Describes sorted keys.',
            quotes: [text],
          },
        ],
      },
    ]),
    ceilings: { sessionCostUsd: 2, sessionTokens: 120000, modelCallsPerTurn: 3 },
    logger: silentLogger,
    queue: null,
    retrieval: null,
  }
  const first = await buildApp(config, deps)
  let second: Awaited<ReturnType<typeof buildApp>> | undefined
  try {
    const started = await first.inject({
      method: 'POST',
      url: '/sessions',
      headers: alice,
      payload: { mode: 'simulation', topicIds: ['dbms.indexes'], turnsPerRound: 2, drill: false },
    })
    expect(started.statusCode).toBe(201)
    const id = started.json().sessionId
    expect(
      (await first.inject({ method: 'GET', url: `/sessions/${id}`, headers: alice })).json()
        .availability,
    ).toBe('awaiting_answer')
    expect(
      (
        await first.inject({
          method: 'POST',
          url: `/sessions/${id}/close-interrupted`,
          headers: alice,
        })
      ).statusCode,
    ).toBe(409)
    const accepted = await first.inject({
      method: 'POST',
      url: `/sessions/${id}/answers`,
      headers: alice,
      payload: { text },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().findings).toEqual([])
    const original = await store.read(id)
    await first.close()
    second = await buildApp(config, deps)
    expect(
      (await second.inject({ method: 'GET', url: `/sessions/${id}`, headers: alice })).json()
        .availability,
    ).toBe('interrupted')
    expect(
      (await second.inject({ method: 'GET', url: `/sessions/${id}/debrief`, headers: alice }))
        .statusCode,
    ).toBe(409)
    expect(
      (
        await second.inject({
          method: 'POST',
          url: `/sessions/${id}/answers`,
          headers: alice,
          payload: { text: 'unsent draft' },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await second.inject({
          method: 'POST',
          url: `/sessions/${id}/close-interrupted`,
          headers: { authorization: 'Bearer bob-test' },
        })
      ).statusCode,
    ).toBe(404)
    const closed = await Promise.all(
      [0, 1].map(() =>
        second!.inject({
          method: 'POST',
          url: `/sessions/${id}/close-interrupted`,
          headers: alice,
        }),
      ),
    )
    expect(closed.map((response) => response.statusCode)).toEqual([200, 200])
    const events = await store.read(id)
    expect(events.slice(0, original.length)).toEqual(original)
    expect(events.length).toBe(original.length + 1)
    const view = replay(events)
    expect(view.closed?.reason).toBe('interrupted')
    expect(
      view.transcript.filter((turn) => turn.role === 'candidate').map((turn) => turn.text),
    ).toEqual([text])
    expect(view.findings).toHaveLength(1)
    expect(
      (await second.inject({ method: 'GET', url: `/sessions/${id}/debrief`, headers: alice }))
        .statusCode,
    ).toBe(200)
  } finally {
    await first.close()
    await second?.close()
    await rm(root, { recursive: true, force: true })
  }
})
