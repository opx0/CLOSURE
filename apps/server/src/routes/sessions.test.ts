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
    payload: { rounds: ['project_deep_dive'], mode: 'coach', turnsPerRound: 1, drill: false },
  })
  expect(response.statusCode).toBe(201)

  const body = response.json() as {
    sessionId: string
    status: string
    question?: { text: string; action: string; claim?: { id: string; assertion: string } }
    round?: { kind: string }
  }
  expect(body.sessionId).toStartWith('ses_')
  expect(body.status).toBe('awaiting_answer')
  expect(body.question?.text).toBe(QUESTION)
  expect(body.question?.action).toBeDefined()
  expect(body.question?.claim?.assertion).toBe('built a durable job queue on PostgreSQL')
  expect(body.round?.kind).toBe('project_deep_dive')
})

test('an answer comes back judged, citing the candidate’s exact words', async () => {
  const { app } = await testApi(scripted())
  const { start, turn } = await interviewed(app)

  expect(turn.findings).toHaveLength(1)
  expect(turn.findings[0]?.attemptId).toBe(start.question?.attemptId ?? 'no question')
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
    payload: { rounds: ['project_deep_dive'], mode: 'coach', turnsPerRound: 2, drill: false },
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

test('a résumé round with no confirmed claims is refused — §4.1 holds at the door', async () => {
  const { app } = await testApi(scripted())
  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { rounds: ['project_deep_dive'] },
  })

  expect(response.statusCode).toBe(409)
  expect(response.json() as { error: string; detail: string }).toEqual({
    error: 'no confirmed claims',
    detail:
      'this round cross-questions your résumé: add it under Résumé & projects (POST /claims, then ' +
      'POST /claims/:id/confirm). An interview round needs no résumé at all.',
  })
})

interface TopicTurn {
  sessionId: string
  status: string
  round?: { kind: string }
  question?: {
    text: string
    round: string
    topic?: { id: string; area: string; title: string }
    artifact?: unknown
  }
}

test('an interview needs no résumé: it opens on the role’s first round, on a topic', async () => {
  const { app } = await testApi({ questions: ['What does an index cost you on every write?'] })

  const response = await app.inject({ method: 'POST', url: '/sessions', payload: {} })
  expect(response.statusCode).toBe(201)

  const body = response.json() as TopicTurn
  expect(body.status).toBe('awaiting_answer')
  expect(body.round?.kind).toBe('cs_fundamentals')
  expect(body.question?.text).toBe('What does an index cost you on every write?')
  expect(body.question?.topic).toEqual({
    id: 'dbms.indexes',
    area: 'dbms',
    title: 'Database indexes',
  })
  expect(body.question?.artifact).toBeUndefined()

  const view = await app.inject({ method: 'GET', url: `/sessions/${body.sessionId}` })
  const { session } = view.json() as {
    session: { claimIds: string[]; roleId: string; level: string; topicIds: string[] }
  }
  expect(session.claimIds).toEqual([])
  expect(session.roleId).toBe('sde_generalist')
  expect(session.level).toBe('junior')
  expect(session.topicIds).toEqual(['dbms.indexes', 'networks.url_to_page', 'oop.four_pillars'])
})

test('a second interview reaches for topics the first one did not plan', async () => {
  const { app } = await testApi()

  const first = await app.inject({ method: 'POST', url: '/sessions', payload: {} })
  const second = await app.inject({ method: 'POST', url: '/sessions', payload: {} })

  const planned = async (sessionId: string) =>
    (
      (await app.inject({ method: 'GET', url: `/sessions/${sessionId}` })).json() as {
        session: { topicIds: string[] }
      }
    ).session.topicIds
  expect(await planned((first.json() as TopicTurn).sessionId)).toEqual([
    'dbms.indexes',
    'networks.url_to_page',
    'oop.four_pillars',
  ])
  expect(await planned((second.json() as TopicTurn).sessionId)).toEqual([
    'oop.solid',
    'os.processes_threads',
    'dbms.normalisation',
  ])
})

test('named topics are asked in the rounds they belong to, and an unknown one is refused', async () => {
  const { app } = await testApi({ questions: ['How would two threads deadlock here?'] })

  const named = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { topicIds: ['os.deadlock'] },
  })
  expect(named.statusCode).toBe(201)
  const body = named.json() as TopicTurn
  expect(body.round?.kind).toBe('cs_fundamentals')
  expect(body.question?.topic).toEqual({ id: 'os.deadlock', area: 'os', title: 'Deadlock' })

  const unknown = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { topicIds: ['os.deadlock', 'os.no_such_topic'] },
  })
  expect(unknown.statusCode).toBe(400)
  expect(unknown.json() as { error: string; detail: string }).toEqual({
    error: 'no such topic',
    detail: 'os.no_such_topic',
  })

  const stray = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { topicIds: ['os.deadlock'], rounds: ['behavioral'] },
  })
  expect(stray.statusCode).toBe(400)
  expect(stray.json() as { error: string; detail: string }).toEqual({
    error: 'a topic belongs to a round that was not requested',
    detail: 'os.deadlock is asked in cs_fundamentals',
  })
})

test('a code walkthrough with nothing pinned is refused, not asked without code', async () => {
  const { app } = await testApi(scripted())
  await confirmedClaim(app)

  const response = await app.inject({
    method: 'POST',
    url: '/sessions',
    payload: { rounds: ['code_walkthrough'] },
  })

  expect(response.statusCode).toBe(400)
  expect(response.json() as { error: string; detail: string }).toEqual({
    error: 'pin a repository first',
    detail: 'a code walkthrough opens files from a pinned repository: POST /snapshots',
  })
})
