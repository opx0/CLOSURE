import { expect, test } from 'bun:test'
import { replay } from '@levelhead/core'
import {
  ANSWER,
  ANSWER_QUOTE,
  EXTRACTION,
  interviewed,
  judged,
  testApi,
} from '../testing/harness.ts'

test('an exact owner gap launches one drill at its original level, persists the receipt and never closes', async () => {
  const passed = {
    findings: [
      {
        kind: 'claim',
        verdict: 'supported',
        rationale: 'Describes the mechanism.',
        confidence: 0.8,
        quotes: [ANSWER_QUOTE],
      },
    ],
  }
  const { app, store } = await testApi({
    questions: ['Explain the queue.', 'Practise that mechanism.'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE), passed],
  })
  try {
    const original = await interviewed(app)
    const gap = (await app.inject('/ledger')).json().gaps[0]
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { mode: 'drill', gapId: gap.id, level: 'staff', turnsPerRound: 20 },
    })
    expect(response.statusCode).toBe(201)
    const opened = response.json()
    expect(opened.question.action).toBe('DRILL')
    const before = replay(await store.read(opened.sessionId))
    expect(before.session?.practiceGapId).toBe(gap.id)
    expect(before.session?.level).toBe(
      replay(await store.read(original.start.sessionId)).session?.level,
    )
    const answer = await app.inject({
      method: 'POST',
      url: `/sessions/${opened.sessionId}/answers`,
      payload: { text: ANSWER },
    })
    expect(answer.statusCode).toBe(200)
    expect(answer.json().status).toBe('closed')
    const saved = replay(await store.read(opened.sessionId)).gaps.get(gap.id)
    expect(saved?.status).toBe('drilled')
    expect(saved?.practiceReceipts?.[0]?.kind).toBe('drill')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/sessions',
          payload: { mode: 'drill', gapId: 'another-owners-gap' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'POST', url: '/sessions', payload: { mode: 'drill' } }))
        .statusCode,
    ).toBe(400)
  } finally {
    await app.close()
  }
})

test('authored hints persist before delivery and the resulting coached answer cannot close a topic gap', async () => {
  const answer = 'The index is maintained on writes.'
  const finding = (levelMet: 'junior' | null) => ({
    findings: [
      {
        kind: 'competency',
        competency: 'trade_offs',
        levelMet,
        rationale: 'Write maintenance was discussed.',
        confidence: 0.8,
        quotes: [answer],
      },
    ],
  })
  const { app, store } = await testApi({
    questions: ['Explain indexes.', 'Practise indexes.'],
    scripted: [finding(null), finding('junior')],
  })
  try {
    const start = (
      await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: {
          topicIds: ['dbms.indexes'],
          level: 'junior',
          mode: 'coach',
          turnsPerRound: 1,
          drill: false,
        },
      })
    ).json()
    await app.inject({
      method: 'POST',
      url: `/sessions/${start.sessionId}/answers`,
      payload: { text: answer },
    })
    const gap = (await app.inject('/ledger')).json().gaps[0]
    const drill = (
      await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { mode: 'drill', gapId: gap.id },
      })
    ).json()
    const hints = await Promise.all(
      [1, 2, 3].map((level) =>
        app.inject({
          method: 'POST',
          url: `/sessions/${drill.sessionId}/hints`,
          payload: { level },
        }),
      ),
    )
    expect(hints.map((response) => response.statusCode)).toEqual([200, 200, 200])
    expect(hints[2]!.json().text).toContain('every insert')
    const assisted = (await store.read(drill.sessionId)).filter(
      (event) => event.kind === 'state_change' && event.payload.change === 'practice_assistance',
    )
    expect(assisted).toHaveLength(3)
    await app.inject({
      method: 'POST',
      url: `/sessions/${drill.sessionId}/answers`,
      payload: { text: answer },
    })
    expect(replay(await store.read(drill.sessionId)).gaps.get(gap.id)?.status).toBe('drilled')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${drill.sessionId}/hints`,
          payload: { level: 1 },
        })
      ).statusCode,
    ).toBe(409)
  } finally {
    await app.close()
  }
})

test('an overdue gap is interleaved as an ordinary question and its failed retrieval reopens it', async () => {
  const { SessionLog } = await import('@levelhead/core')
  const { FixedClock, SeqIds } = await import('../../../cli/src/testing/fakes.ts')
  const { app, store } = await testApi({
    questions: ['Original.', 'Question one.', 'Question two.', 'Question three.'],
    scripted: [
      EXTRACTION,
      judged(ANSWER_QUOTE),
      judged(ANSWER_QUOTE),
      judged(ANSWER_QUOTE),
      judged(ANSWER_QUOTE),
    ],
  })
  try {
    await interviewed(app)
    const originalGap = (await app.inject('/ledger')).json().gaps[0]
    const log = await SessionLog.open(
      { store, clock: new FixedClock(), ids: new SeqIds() },
      '_retrieval_seed',
    )
    await log.append('state_change', {
      change: 'gap_opened',
      gap: {
        ...originalGap,
        id: 'gap_due',
        status: 'closed_under_transfer',
        lastTouchedAt: '2026-09-01T00:00:00.000Z',
        transferAttemptIds: ['old_transfer'],
      },
    })
    const start = (
      await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { mode: 'coach', rounds: ['project_deep_dive'], turnsPerRound: 3, drill: false },
      })
    ).json()
    for (let index = 0; index < 3; index++) {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${start.sessionId}/answers`,
        payload: { text: ANSWER },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().notices.join(' ')).not.toMatch(/retrieval|recall|spaced review/i)
    }
    const view = replay(await store.read(start.sessionId))
    expect(view.gaps.get('gap_due')?.status).toBe('open')
    expect(view.gaps.get('gap_due')?.practiceReceipts?.at(-1)?.kind).toBe('retrieval')
    expect(view.gaps.get('gap_due')?.retrievals?.at(-1)?.passed).toBe(false)
  } finally {
    await app.close()
  }
})
