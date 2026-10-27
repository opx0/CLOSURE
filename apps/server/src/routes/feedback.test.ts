import { expect, test } from 'bun:test'
import { gapsAcrossViews, replay } from '@levelhead/core'
import {
  ANSWER,
  ANSWER_QUOTE,
  EXTRACTION,
  interviewed,
  judged,
  testApi,
} from '../testing/harness.ts'

test('a pending dispute preserves feedback; an explicit sourced self-review supersedes it without rewriting history', async () => {
  const { app, store } = await testApi({
    questions: ['Explain the queue.'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  })
  try {
    const { start, turn } = await interviewed(app)
    const findingId = turn.findings[0]!.id
    const original = await store.read(start.sessionId)
    const pending = {
      requestId: 'dispute-1',
      findingId,
      state: 'pending',
      reason: 'The quote does not establish this conclusion.',
      sourceRefs: [],
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/feedback`,
          payload: pending,
        })
      ).statusCode,
    ).toBe(200)
    expect(replay(await store.read(start.sessionId)).findings).toHaveLength(1)
    expect(
      (await app.inject(`/sessions/${start.sessionId}/debrief`)).json().competence.plan
        .uncertainty[0].summary,
    ).toContain('pending review')
    const error = { ...pending, requestId: 'review-1', state: 'confirmed_error' }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/feedback`,
          payload: error,
        })
      ).statusCode,
    ).toBe(400)
    const reviewed = { ...error, sourceRefs: ['transcript:' + ANSWER_QUOTE] }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/feedback`,
          payload: reviewed,
        })
      ).statusCode,
    ).toBe(200)
    const length = (await store.read(start.sessionId)).length
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/feedback`,
          payload: reviewed,
        })
      ).statusCode,
    ).toBe(200)
    expect((await store.read(start.sessionId)).length).toBe(length)
    const view = replay(await store.read(start.sessionId))
    expect(view.findings).toHaveLength(0)
    expect(view.historicalFindings).toHaveLength(1)
    expect([...view.gaps.values()][0]?.status).toBe('unverified')
    expect(view.findingReviews?.at(-1)?.reviewer).toBe('candidate_self_review')
    expect((await store.read(start.sessionId)).slice(0, original.length)).toEqual(original)
  } finally {
    await app.close()
  }
})

test('answer corrections are versioned, retry-safe and preserve original evidence while removing superseded weaknesses', async () => {
  const { app, store } = await testApi({
    questions: ['Explain the queue.'],
    scripted: [EXTRACTION, judged(ANSWER_QUOTE)],
  })
  try {
    const { start, turn } = await interviewed(app)
    const original = replay(await store.read(start.sessionId))
    const body = {
      requestId: 'correction-1',
      attemptId: turn.findings[0]!.attemptId,
      previousRevision: 1,
      text: 'The transcript missed my explanation of the idempotency key.',
      reason: 'Speech recognition omitted a sentence.',
    }
    const first = await app.inject({
      method: 'POST',
      url: `/sessions/${start.sessionId}/corrections`,
      payload: body,
    })
    expect(first.json<{ revision: number; pendingReassessment: boolean }>()).toEqual({
      revision: 2,
      pendingReassessment: true,
    })
    const length = (await store.read(start.sessionId)).length
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/corrections`,
          payload: body,
        })
      ).statusCode,
    ).toBe(200)
    expect((await store.read(start.sessionId)).length).toBe(length)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/corrections`,
          payload: { ...body, text: 'different' },
        })
      ).statusCode,
    ).toBe(409)
    const concurrent = await Promise.all(
      ['one', 'two'].map((text) =>
        app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/corrections`,
          payload: { ...body, requestId: text, previousRevision: 2, text },
        }),
      ),
    )
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409])
    const view = replay(await store.read(start.sessionId))
    expect(view.answerCorrections?.map((correction) => correction.revision)).toEqual([2, 3])
    expect([...view.sources.values()]).toContain(ANSWER)
    expect(view.findings).toHaveLength(0)
    expect(view.historicalFindings?.map((finding) => finding.id)).toEqual(
      original.findings.map((finding) => finding.id),
    )
    const audit = (await app.inject(`/sessions/${start.sessionId}/feedback`)).json()
    expect(audit.pendingReassessment).toBe(true)
    expect(audit.historicalFindings).toHaveLength(1)
    const plan = (await app.inject(`/sessions/${start.sessionId}/debrief`)).json().competence.plan
    expect(plan.leading).toEqual([])
    expect(plan.strengths).toEqual([])
    expect(plan.uncertainty[0].summary).toContain('not been reassessed')
    const gap = [...original.gaps.values()][0]!
    const laterCopy = {
      ...original,
      gaps: new Map([[gap.id, { ...gap, lastTouchedAt: '2099-01-01T00:00:00.000Z' }]]),
    }
    expect(gapsAcrossViews([view, laterCopy]).get(gap.id)?.status).toBe('unverified')
    const receiptOnly = {
      ...original,
      gaps: new Map([
        [
          'receipt-only',
          {
            ...gap,
            id: 'receipt-only',
            findingIds: ['unrelated-finding'],
            transferAttemptIds: [body.attemptId],
            status: 'closed_under_transfer' as const,
          },
        ],
      ]),
    }
    expect(gapsAcrossViews([view, receiptOnly]).get('receipt-only')?.status).toBe('unverified')
    expect((await app.inject('/ledger')).json().gaps[0].status).toBe('unverified')
  } finally {
    await app.close()
  }
})

test('active simulations cannot expose debriefs or accept post-interview corrections', async () => {
  const { app } = await testApi({ questions: ['Explain indexes.'] })
  try {
    const start = (
      await app.inject({ method: 'POST', url: '/sessions', payload: { mode: 'simulation' } })
    ).json()
    expect((await app.inject(`/sessions/${start.sessionId}/debrief`)).statusCode).toBe(409)
    expect((await app.inject(`/sessions/${start.sessionId}/feedback`)).statusCode).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${start.sessionId}/corrections`,
          payload: {
            requestId: 'x',
            attemptId: start.question.attemptId,
            previousRevision: 1,
            text: '',
            reason: 'not yet accepted',
          },
        })
      ).statusCode,
    ).toBe(409)
  } finally {
    await app.close()
  }
})
