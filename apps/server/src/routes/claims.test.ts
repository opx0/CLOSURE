import { test, expect } from 'bun:test'
import { Buffer } from 'node:buffer'
import { EXTRACTION, RESUME, RESUME_QUOTE, confirmedClaim, testApi } from '../testing/harness.ts'

test('a résumé in, a claim set out, sourced to spans that resolve byte-for-byte', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })

  const response = await app.inject({
    method: 'POST',
    url: '/claims',
    payload: { resumeText: RESUME },
  })
  expect(response.statusCode).toBe(200)

  const body = response.json() as {
    sourceId: string
    claims: { id: string; spanId: string; confirmedByCandidate: boolean }[]
    spans: { id: string; startByte: number; endByte: number; quoted: string }[]
  }
  expect(body.claims).toHaveLength(1)

  const span = body.spans.find((candidate) => candidate.id === body.claims[0]?.spanId)
  expect(span).toBeDefined()
  const resume = Buffer.from(RESUME, 'utf8')
  expect(resume.subarray(span!.startByte, span!.endByte).toString('utf8')).toBe(span!.quoted)
  expect(span!.quoted).toBe(RESUME_QUOTE)

  expect(body.claims[0]?.confirmedByCandidate).toBe(false)
})

test('confirming is the candidate owning the claim set, edits included', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })
  const extracted = await app.inject({
    method: 'POST',
    url: '/claims',
    payload: { resumeText: RESUME },
  })
  const claimId = (extracted.json() as { claims: { id: string }[] }).claims[0]!.id

  const confirmed = await app.inject({
    method: 'POST',
    url: `/claims/${claimId}/confirm`,
    payload: { confirmed: true, editedAssertion: 'built a job queue, mostly on PostgreSQL' },
  })
  expect(confirmed.statusCode).toBe(200)

  const body = confirmed.json() as { claim: { assertion: string; confirmedByCandidate: boolean } }
  expect(body.claim.confirmedByCandidate).toBe(true)
  expect(body.claim.assertion).toBe('built a job queue, mostly on PostgreSQL')
})

test('confirming a claim that does not exist is a 404, not a stack trace', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })
  const response = await app.inject({
    method: 'POST',
    url: '/claims/claim_9999/confirm',
    payload: { confirmed: true },
  })

  expect(response.statusCode).toBe(404)
  expect(response.json() as { error: string; detail: string }).toEqual({
    error: 'no such claim',
    detail: 'claim_9999',
  })
})

test('an extraction failure is a named failure, never an empty claim set', async () => {
  const { app } = await testApi({ scripted: [] })
  const response = await app.inject({
    method: 'POST',
    url: '/claims',
    payload: { resumeText: RESUME },
  })

  expect(response.statusCode).toBe(502)
  expect((response.json() as { error: string }).error).toBe('claim extraction failed')
})

test('the claim set reads back as confirmed, with the résumé it was extracted from', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })

  const empty = await app.inject({ method: 'GET', url: '/claims' })
  expect(empty.statusCode).toBe(200)
  expect(empty.json() as unknown).toEqual({ resumeText: null, claims: [], spans: [] })

  const claimId = await confirmedClaim(app)
  const body = (await app.inject({ method: 'GET', url: '/claims' })).json() as {
    resumeText: string | null
    claims: { id: string; assertion: string; confirmedByCandidate: boolean }[]
    spans: { quoted: string }[]
  }
  expect(body.resumeText).toBe(RESUME)
  expect(
    body.claims.map(({ id, assertion, confirmedByCandidate }) => ({
      id,
      assertion,
      confirmedByCandidate,
    })),
  ).toEqual([
    {
      id: claimId,
      assertion: 'built a durable job queue on PostgreSQL',
      confirmedByCandidate: true,
    },
  ])
  expect(body.spans.map((span) => span.quoted)).toEqual([RESUME_QUOTE])
})
