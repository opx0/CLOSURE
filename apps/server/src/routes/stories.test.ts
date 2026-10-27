import { expect, test } from 'bun:test'
import { testApi } from '../testing/harness.ts'

test('candidate-confirmed stories retain their versions and reject stale edits', async () => {
  const { app } = await testApi()
  try {
    const original = {
      previousRevision: 0,
      situation: 'A queue stalled.',
      action: 'I investigated the lease.',
      result: 'We recovered processing.',
      confirmed: true,
    }
    const created = await app.inject({ method: 'POST', url: '/stories', payload: original })
    expect(created.statusCode).toBe(200)
    const first = created.json()
    const edited = await app.inject({
      method: 'POST',
      url: '/stories',
      payload: {
        ...original,
        id: first.id,
        previousRevision: 1,
        result: 'Processing recovered after the lease expired.',
      },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().revision).toBe(2)
    expect((await app.inject('/stories')).json().stories).toEqual([first, edited.json()])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/stories',
          payload: { ...original, id: first.id, previousRevision: 1 },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/stories',
          payload: { ...original, confirmed: false },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/stories',
          payload: { ...original, situation: ' ' },
        })
      ).statusCode,
    ).toBe(400)
  } finally {
    await app.close()
  }
})

test('behavioral rehearsal pins and cites the selected confirmed version across edits', async () => {
  const answer = 'I investigated the lease and restored the queue.'
  const judgment = {
    findings: [
      {
        kind: 'competency',
        competency: 'mechanism',
        levelMet: 'junior',
        rationale: 'Described the action.',
        confidence: 0.8,
        quotes: [answer],
      },
    ],
  }
  const { app, store } = await testApi({
    questions: ['What did you do?', 'What would you change?'],
    scripted: [judgment, judgment],
  })
  try {
    const original = {
      previousRevision: 0,
      situation: 'A queue stalled.',
      action: 'I investigated the lease.',
      result: 'We recovered processing.',
      confirmed: true,
    }
    const story = (await app.inject({ method: 'POST', url: '/stories', payload: original })).json()
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/sessions',
          payload: {
            rounds: ['behavioral'],
            storyId: story.id,
            storyRevision: 1,
            mode: 'transfer',
            gapId: 'another-gap',
          },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/sessions',
          payload: { rounds: ['cs_fundamentals'], storyId: story.id, storyRevision: 1 },
        })
      ).statusCode,
    ).toBe(400)
    const start = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        rounds: ['behavioral'],
        storyId: story.id,
        storyRevision: 1,
        mode: 'coach',
        turnsPerRound: 2,
        drill: false,
      },
    })
    expect(start.statusCode).toBe(201)
    const sessionId = start.json().sessionId
    await app.inject({
      method: 'POST',
      url: '/stories',
      payload: { ...original, id: story.id, previousRevision: 1, result: 'A newer version.' },
    })
    const first = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/answers`,
      payload: { text: answer },
    })
    expect(first.json().findings[0].evidenceIds.length).toBeGreaterThan(0)
    await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/answers`,
      payload: { text: answer },
    })
    expect((await app.inject(`/sessions/${sessionId}`)).json().session.story).toEqual(story)
    const questions = (await store.read(sessionId)).filter((event) => event.kind === 'question')
    expect(questions.length).toBe(2)
    expect(
      questions.every(
        (event) =>
          event.kind === 'question' &&
          event.payload.storyId === story.id &&
          event.payload.storyRevision === 1,
      ),
    ).toBe(true)
  } finally {
    await app.close()
  }
})
