import { test, expect } from 'bun:test'
import {
  ANSWER,
  ANSWER_QUOTE,
  EXTRACTION,
  confirmedClaim,
  interviewed,
  judged,
  testApi,
} from '../testing/harness.ts'

const QUESTION = 'How does a job get picked up, and what happens if the worker dies mid-job?'

function scripted() {
  return {
    questions: [QUESTION],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  }
}

test('starting a session returns the first question and parks the loop on the answer', async () => {
  const { app } = await testApi(scripted())
  await confirmedClaim(app)

  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { mode: 'coach', turnsPerRound: 1, drill: false },
  })
  expect(response.statusCode).toBe(201)

  const body = response.json() as {
    sessionId: string
    status: string
    question?: { text: string; action: string }
    round?: { kind: string }
  }
  expect(body.sessionId).toStartWith('ses_')
  expect(body.status).toBe('awaiting_answer')
  expect(body.question?.text).toBe(QUESTION)
  expect(body.question?.action).toBeDefined()
  expect(body.round?.kind).toBe('project_deep_dive')
})

test('an answer comes back judged, citing the candidate’s exact words', async () => {
  const { app } = await testApi(scripted())
  const { turn } = await interviewed(app)

  expect(turn.findings).toHaveLength(1)
  expect(turn.quotes.length).toBeGreaterThan(0)

  const cited = turn.quotes.find((quote) =>
    turn.findings[0]?.evidenceIds.includes(quote.evidenceId),
  )
  expect(cited).toBeDefined()
  expect(cited!.quoted).toBe(ANSWER_QUOTE)
  // Not "close to what they said": the exact bytes, present in the answer that was posted.
  expect(ANSWER).toContain(cited!.quoted)
})

// Load-bearing claim: one `runSession` stays suspended across requests — turn two continues the
// same loop, not a second one restarted from the log with the state re-guessed.
test('the second answer gets the second question, from the same suspended run', async () => {
  const { app } = await testApi({
    questions: [QUESTION, 'And when the lease expires?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE), judged('We leased each job for 30 seconds')],
  })
  await confirmedClaim(app)

  const started = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { mode: 'coach', turnsPerRound: 2, drill: false },
  })
  const { sessionId } = started.json() as { sessionId: string }

  const first = await app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/answers`,
    payload: { text: ANSWER },
  })
  const firstTurn = first.json() as { status: string; question?: { text: string; turn: number } }
  expect(firstTurn.status).toBe('awaiting_answer')
  expect(firstTurn.question?.text).toBe('And when the lease expires?')
  expect(firstTurn.question?.turn).toBe(1)

  // Mid-interview, the log is already readable: the suspended loop holds no state the fold cannot
  // rebuild.
  const midway = await app.inject({ method: 'GET', url: `/sessions/${sessionId}` })
  expect((midway.json() as { closed: unknown }).closed).toBeNull()

  const second = await app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/answers`,
    payload: { text: ANSWER },
  })
  const secondTurn = second.json() as { status: string; stoppedBy?: string }
  expect(secondTurn.status).toBe('closed')
  expect(secondTurn.stoppedBy).toBe('turns')

  const events = (
    await app.inject({ method: 'GET', url: `/sessions/${sessionId}/events` })
  ).json() as { kind: string }[]
  expect(events.filter((event) => event.kind === 'answer')).toHaveLength(2)
  expect(events.filter((event) => event.kind === 'question')).toHaveLength(2)
})

test('the replayed view and the raw log are the same session, read two ways', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const view = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}` })
  expect(view.statusCode).toBe(200)
  const body = view.json() as {
    sessionId: string
    transcript: { role: string; text: string }[]
    findings: unknown[]
    gaps: unknown[]
    closed: { reason: string } | null
  }
  expect(body.sessionId).toBe(start.sessionId)
  expect(body.transcript.map((turn) => turn.role)).toEqual(['interviewer', 'candidate'])
  expect(body.transcript[1]?.text).toBe(ANSWER)
  expect(body.closed).not.toBeNull()

  const log = await app.inject({ method: 'GET', url: `/sessions/${start.sessionId}/events` })
  expect(log.statusCode).toBe(200)
  const events = log.json() as { seq: number; kind: string; sessionId: string }[]
  expect(events[0]?.seq).toBe(0)
  expect(events.map((event) => event.kind)).toContain('answer')
  expect(new Set(events.map((event) => event.sessionId))).toEqual(new Set([start.sessionId]))
})

test('an unknown session is a clean 404 on every read, and on the answer route', async () => {
  const { app } = await testApi(scripted())

  for (const url of ['/sessions/ses_9999', '/sessions/ses_9999/events']) {
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(404)
    expect(response.json() as { error: string; detail: string }).toEqual({
      error: 'no such session',
      detail: 'ses_9999',
    })
  }

  const answered = await app.inject({
    method: 'POST',
    url: '/sessions/ses_9999/answers',
    payload: { text: 'hello' },
  })
  expect(answered.statusCode).toBe(404)
  expect(answered.body).not.toContain('at ')
})

test('a session id that is not a session id is refused by the schema, not by the store', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'GET', url: '/sessions/..%2Fetc%2Fpasswd' })

  expect(response.statusCode).toBe(400)
})

test('answering a closed session is a conflict, not a second interview', async () => {
  const { app } = await testApi(scripted())
  const { start } = await interviewed(app)

  const again = await app.inject({
    method: 'POST',
    url: `/sessions/${start.sessionId}/answers`,
    payload: { text: 'and one more thing' },
  })
  expect(again.statusCode).toBe(409)
})

test('no confirmed claims means no session — §4.1 holds at the door', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({ method: 'POST', url: '/sessions', payload: {} })

  expect(response.statusCode).toBe(409)
  expect((response.json() as { error: string }).error).toBe('no confirmed claims')
})
