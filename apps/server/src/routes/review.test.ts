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
