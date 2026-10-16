import { expect, test } from 'bun:test'
import type { AnyEvent, Snapshot } from '@levelhead/contracts'
import { EVENT_SCHEMA_VERSION } from '@levelhead/contracts'
import { replay } from '../events/replay.ts'
import {
  DEFAULT_RETENTION,
  availabilitySummary,
  citationAvailability,
  snapshotExpiresAt,
  snapshotIsExpired,
  tombstoneFor,
} from './policy.ts'

const PINNED_AT = '2026-06-01T00:00:00.000Z'

const snapshot: Snapshot = {
  id: 'snapshot_1',
  repoPath: '/srv/queue',
  commit: 'a'.repeat(40),
  pinnedAt: PINNED_AT,
  fileCount: 3,
}

function event(seq: number, payload: AnyEvent['payload']): AnyEvent {
  return {
    eventId: `evt_${seq}`,
    sessionId: 'ses_1',
    seq,
    occurredAt: PINNED_AT,
    schemaVersion: EVENT_SCHEMA_VERSION,
    kind: 'state_change',
    payload,
  } as AnyEvent
}

test('a snapshot expires exactly one retention window after it was pinned', () => {
  expect(snapshotExpiresAt(snapshot, DEFAULT_RETENTION)).toBe('2026-08-30T00:00:00.000Z')
  expect(snapshotIsExpired(snapshot, '2026-08-29T23:59:59.000Z', DEFAULT_RETENTION)).toBe(false)
  expect(snapshotIsExpired(snapshot, '2026-08-30T00:00:00.000Z', DEFAULT_RETENTION)).toBe(true)
})

// Ticket 13: the bytes go, the citation stays. A deleted snapshot must never read as a citation
// that failed to resolve — that would make a deletion look like a defect.
test('an artifact citation reads as snapshot_deleted after the tombstone, not as unresolvable', () => {
  const artifact = {
    id: 'artifact_1',
    snapshotId: snapshot.id,
    kind: 'file' as const,
    path: 'src/queue.ts',
  }
  const evidence = {
    id: 'evidence_1',
    subject: { kind: 'claim' as const, claimId: 'claim_1' },
    target: { kind: 'artifact' as const, artifactId: artifact.id },
    trust: 'repository_observed' as const,
  }

  const pinned = replay([
    event(0, { change: 'snapshot_pinned', snapshot, artifacts: [artifact], evidence: [evidence] }),
  ])
  expect(citationAvailability(evidence, pinned)).toBe('resolved')
  expect(availabilitySummary(pinned)).toEqual({
    resolved: 1,
    unresolvable: 0,
    snapshotDeleted: 0,
    notInThisSession: 0,
  })

  const deleted = replay([
    event(0, { change: 'snapshot_pinned', snapshot, artifacts: [artifact], evidence: [evidence] }),
    event(1, {
      change: 'snapshot_deleted',
      tombstone: tombstoneFor({
        snapshot,
        contentHash: 'hash',
        artifactCount: 1,
        reason: 'candidate_requested',
        deletedAt: '2026-09-01T00:00:00.000Z',
      }),
    }),
  ])
  expect(citationAvailability(evidence, deleted)).toBe('snapshot_deleted')
  expect(availabilitySummary(deleted)).toEqual({
    resolved: 0,
    unresolvable: 0,
    snapshotDeleted: 1,
    notInThisSession: 0,
  })
})

// A claim's résumé span lives in the claim-set log, not in the session that cited it. Calling that
// unresolvable would tell the candidate their evidence failed when it did not.
test('a citation into a source this session does not carry is not a broken citation', () => {
  const view = replay([event(0, { change: 'session_closed', reason: 'turns' })])
  const elsewhere = {
    id: 'evidence_2',
    subject: { kind: 'claim' as const, claimId: 'claim_1' },
    target: { kind: 'span' as const, spanId: 'span_in_the_claim_set' },
    trust: 'candidate_asserted' as const,
  }
  const dangling = {
    id: 'evidence_3',
    subject: { kind: 'claim' as const, claimId: 'claim_1' },
    target: { kind: 'artifact' as const, artifactId: 'artifact_missing' },
    trust: 'repository_observed' as const,
  }

  expect(citationAvailability(elsewhere, view)).toBe('not_in_this_session')
  expect(citationAvailability(dangling, view)).toBe('not_in_this_session')
})

test('a span whose bytes do not match its source is unresolvable, and stays that way', () => {
  const view = replay([
    event(0, {
      change: 'source_registered',
      sourceId: 'answer:att_1',
      kind: 'answer',
      text: 'we leased each job',
      contentHash: 'hash',
    }),
    {
      eventId: 'evt_1',
      sessionId: 'ses_1',
      seq: 1,
      occurredAt: PINNED_AT,
      schemaVersion: EVENT_SCHEMA_VERSION,
      kind: 'evaluation',
      payload: {
        attemptId: 'att_1',
        findings: [
          {
            id: 'finding_1',
            attemptId: 'att_1',
            rubric: { id: 'claim_status', version: 1 },
            level: 'mid',
            rationale: 'says nothing about duplicates',
            confidence: 0.5,
            modelVersion: 'fake',
            promptVersion: '1',
            transcriptSpanIds: ['span_1'],
            evidenceIds: ['evidence_1'],
            kind: 'claim',
            claimId: 'claim_1',
            verdict: 'partially_supported',
          },
        ],
        spans: [
          {
            id: 'span_1',
            sourceId: 'answer:att_1',
            startByte: 0,
            endByte: 5,
            quoted: 'never said this',
          },
        ],
        evidence: [
          {
            id: 'evidence_1',
            subject: { kind: 'attempt', attemptId: 'att_1' },
            target: { kind: 'span', spanId: 'span_1' },
            trust: 'transcript_observed',
          },
        ],
        invocation: {
          id: 'inv_1',
          port: 'evaluator',
          modelAlias: 'fake',
          promptId: 'answer-evaluation',
          promptVersion: 1,
          promptHash: 'hash',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          stopReason: 'end_turn',
          latencyMs: 1,
          occurredAt: PINNED_AT,
        },
      },
    } as AnyEvent,
  ])

  expect(availabilitySummary(view).unresolvable).toBe(1)
})
