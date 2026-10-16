import { expect, test } from 'bun:test'
import { ANSWER_QUOTE, EXTRACTION, interviewed, judged, testApi } from '../testing/harness.ts'

test('résumé feedback reads a confirmed line with what the interview found, in the candidate’s words', async () => {
  const { app } = await testApi({
    questions: ['How does a job get picked up?'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  })
  await interviewed(app)

  const response = await app.inject({ method: 'GET', url: '/resume/feedback' })

  expect(response.statusCode).toBe(200)
  expect(response.json() as unknown).toEqual({
    lines: [
      {
        spanId: 'span_0001',
        text: 'Built a durable job queue on PostgreSQL',
        claimIds: ['claim_0001'],
        tags: [
          {
            kind: 'code_not_checked',
            claimId: 'claim_0001',
            advice:
              'Not checked against code because no repository is pinned; pin the project behind this line so it can be cross-questioned file by file.',
            quotes: [],
            findingIds: [],
            gapIds: [],
            artifactPaths: [],
          },
          {
            kind: 'partially_supported',
            claimId: 'claim_0001',
            advice:
              'Your answer covered only part of this line; narrow it to what you explained, or prepare the part you could not.',
            quotes: ['I do not think we handled double completion'],
            findingIds: ['finding_0001'],
            gapIds: [],
            artifactPaths: [],
          },
          {
            kind: 'open_gap',
            claimId: 'claim_0001',
            advice:
              'This line has a gap that has not yet held under a transfer question; close it before an interviewer who reads this line finds it.',
            quotes: ['I do not think we handled double completion'],
            findingIds: ['finding_0001'],
            gapIds: ['gap_0001'],
            artifactPaths: [],
          },
        ],
      },
    ],
    snapshotIds: [],
  })
})

test('with no résumé extracted, there is no line to give feedback on', async () => {
  const { app } = await testApi()

  const response = await app.inject({ method: 'GET', url: '/resume/feedback' })

  expect(response.json() as unknown).toEqual({ lines: [], snapshotIds: [] })
})
