import { expect, test } from 'bun:test'
import { ANSWER, ANSWER_QUOTE, testApi } from '../testing/harness.ts'

const knewIt = (competency: string) => ({
  findings: [
    {
      kind: 'competency',
      competency,
      levelMet: 'junior',
      rationale: 'Said what the lease is for.',
      confidence: 0.7,
      quotes: [ANSWER_QUOTE],
    },
  ],
})

interface ReviewBody {
  subjects: { subject: string; label: string; attempts: { finding: { competency?: string } }[] }[]
}

test('review groups answers by the topic they answered, not by the competency judged', async () => {
  const { app } = await testApi({
    questions: ['How do two threads deadlock?', 'What does ordering locks cost you?'],
    scripted: [knewIt('mechanism'), knewIt('trade_offs')],
  })

  const started = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { topicIds: ['os.deadlock'], turnsPerRound: 2, mode: 'coach', drill: false },
  })
  const { sessionId } = started.json() as { sessionId: string }
  for (let turn = 0; turn < 2; turn += 1) {
    await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/answers`,
      payload: { text: ANSWER },
    })
  }

  const review = (await app.inject({ method: 'GET', url: '/review' })).json() as ReviewBody
  expect(
    review.subjects.map(({ subject, label, attempts }) => ({
      subject,
      label,
      judged: attempts.map((attempt) => attempt.finding.competency),
    })),
  ).toEqual([{ subject: 'os.deadlock', label: 'Deadlock', judged: ['mechanism', 'trade_offs'] }])
})

test('review flags changed evaluator and superseded feedback instead of presenting it as progress', async () => {
  const { app, store } = await testApi({
    questions: ['First?', 'Second?'],
    scripted: [knewIt('mechanism'), knewIt('trade_offs')],
  })
  try {
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { topicIds: ['os.deadlock'], turnsPerRound: 1, mode: 'coach', drill: false },
    })
    const sessionId = started.json().sessionId
    const first = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/answers`,
      payload: { text: ANSWER },
    })
    const next = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { topicIds: ['os.deadlock'], turnsPerRound: 1, mode: 'coach', drill: false },
    })
    const nextSessionId = next.json().sessionId
    await app.inject({
      method: 'POST',
      url: `/sessions/${nextSessionId}/answers`,
      payload: { text: ANSWER },
    })
    const finding = first.json().findings[0]
    const events = await store.read(nextSessionId)
    store.sessions.set(
      nextSessionId,
      events.map((event) =>
        event.kind === 'evaluation'
          ? {
              ...event,
              payload: {
                ...event.payload,
                invocation: { ...event.payload.invocation, modelAlias: 'different-model' },
              },
            }
          : event,
      ),
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/corrections`,
          payload: {
            requestId: 'review-correction',
            attemptId: finding.attemptId,
            previousRevision: 1,
            text: 'Corrected answer',
            reason: 'Transcript correction',
          },
        })
      ).statusCode,
    ).toBe(200)
    const response = await app.inject('/review')
    expect(response.statusCode).toBe(200)
    const attempts = response.json().subjects[0].attempts
    expect(attempts.map((row: { practice: string }) => row.practice)).toEqual([
      'unclassified',
      'unclassified',
    ])
    expect(attempts.map((row: { superseded: boolean }) => row.superseded)).toEqual([true, false])
    expect(attempts.map((row: { versionChanged: boolean }) => row.versionChanged)).toEqual([
      false,
      true,
    ])
    store.sessions.set(
      nextSessionId,
      events.map((event) =>
        event.kind === 'evaluation'
          ? {
              ...event,
              payload: {
                ...event.payload,
                invocation: { ...event.payload.invocation, promptHash: 'new-prompt-hash' },
              },
            }
          : event,
      ),
    )
    expect((await app.inject('/review')).json().subjects[0].attempts[1].versionChanged).toBe(true)
    store.sessions.set(
      nextSessionId,
      events.map((event) =>
        event.kind === 'state_change' && event.payload.change === 'session_started'
          ? {
              ...event,
              payload: {
                ...event.payload,
                session: {
                  ...event.payload.session,
                  rubricSet: event.payload.session.rubricSet.map((rubric) => ({
                    ...rubric,
                    version: rubric.version + 1,
                  })),
                },
              },
            }
          : event,
      ),
    )
    expect((await app.inject('/review')).json().subjects[0].attempts[1].versionChanged).toBe(true)
  } finally {
    await app.close()
  }
})

test('review withholds findings while a simulation is still open', async () => {
  const { app } = await testApi({
    questions: ['First?', 'Second?'],
    scripted: [knewIt('mechanism')],
  })
  try {
    const started = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { topicIds: ['os.deadlock'], turnsPerRound: 2, mode: 'simulation', drill: false },
    })
    const sessionId = started.json().sessionId
    await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/answers`,
      payload: { text: ANSWER },
    })
    expect((await app.inject('/review')).json().subjects).toEqual([])
  } finally {
    await app.close()
  }
})
