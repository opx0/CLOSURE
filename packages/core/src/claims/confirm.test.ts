import { test, expect } from 'bun:test'
import type { Claim, InvocationRecord, Span } from '@closer/contracts'
import { claimConfirmedPayload, claimsExtractedPayload } from './confirm.ts'

const span: Span = {
  id: 'span-1',
  sourceId: 'src-resume',
  startByte: 0,
  endByte: 5,
  quoted: 'Built',
}

const claim: Claim = {
  id: 'claim-1',
  spanId: span.id,
  type: 'built',
  assertion: 'built a durable job queue',
  technologies: ['PostgreSQL'],
  metrics: [],
  implied: false,
  confirmedByCandidate: false,
  extractorVersion: 'claim-extraction@v1#0123456789abcdef',
}

const invocation: InvocationRecord = {
  id: 'inv-1',
  port: 'evaluator',
  modelAlias: 'fake-model',
  promptId: 'claim-extraction',
  promptVersion: 1,
  promptHash: 'fakehash',
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0,
  stopReason: 'end_turn',
  latencyMs: 1,
  occurredAt: '2026-09-09T12:00:00.000Z',
}

test('the extraction payload carries the spans beside the claims', () => {
  const payload = claimsExtractedPayload({ claims: [claim], spans: [span], invocation })

  expect(payload.change).toBe('claims_extracted')
  expect(payload.spans).toEqual([span])
  expect(payload.claims[0]?.spanId).toBe(span.id)
})

test('an unedited confirmation omits editedAssertion rather than logging undefined', () => {
  const payload = claimConfirmedPayload({ claimId: 'claim-1', confirmed: true })

  expect('editedAssertion' in payload).toBe(false)
  expect(payload).toEqual({ change: 'claim_confirmed', claimId: 'claim-1', confirmed: true })
})

test('a reworded confirmation logs the candidate’s wording', () => {
  const payload = claimConfirmedPayload({
    claimId: 'claim-1',
    confirmed: true,
    editedAssertion: 'built a job queue that survives worker failure',
  })

  expect(payload.editedAssertion).toBe('built a job queue that survives worker failure')
})
