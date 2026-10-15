import { expect, test } from 'bun:test'
import type { Finding, Span } from '@levelhead/contracts'
import { findingOutcome } from './arm.ts'

test('a competency abstention is published with the reason it declined, not as a bare judgment', () => {
  const finding: Finding = {
    id: 'finding_1',
    attemptId: 'att_1',
    rubric: { id: 'mechanism', version: 1 },
    level: 'junior',
    rationale: 'What happens after the locks are ordered is referred to but never described.',
    confidence: 0.6,
    modelVersion: 'fake',
    promptVersion: '2',
    transcriptSpanIds: ['span_1'],
    evidenceIds: ['evidence_1'],
    kind: 'competency_abstained',
    competency: 'mechanism',
    abstention: 'insufficient_evidence',
  }
  const spans = new Map<string, Span>([
    [
      'span_1',
      {
        id: 'span_1',
        sourceId: 'answer_1',
        startByte: 0,
        endByte: 13,
        quoted: 'I am not sure',
      },
    ],
  ])

  expect(findingOutcome(finding, spans)).toEqual({
    findingId: 'finding_1',
    kind: 'competency_abstained',
    competency: 'mechanism',
    verdict: null,
    abstention: 'insufficient_evidence',
    confidence: 0.6,
    rationale: 'What happens after the locks are ordered is referred to but never described.',
    quotes: ['I am not sure'],
  })
})
