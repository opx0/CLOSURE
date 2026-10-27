import type {
  AnyEvent,
  AnswerCorrection,
  FindingReview,
  Artifact,
  Claim,
  DeliveryReport,
  Evidence,
  Finding,
  GapEntry,
  InvocationRecord,
  KinematicsReport,
  PolicyAction,
  ProsodyReport,
  RoundKind,
  Session,
  Snapshot,
  SessionState,
  SnapshotTombstone,
  Span,
} from '@levelhead/contracts'
import { applyPracticeOutcome, PracticeOutcomeError } from '../gaps/outcome.ts'

export interface AttemptRecord {
  readonly id: string
  readonly claimId?: string
  readonly topicId?: string
  readonly action: PolicyAction
  readonly pressureLevel: number
  // Null between action-selected and question-rendered; `Attempt` in contracts requires the id once complete.
  readonly questionEventId: string | null
}

// Structurally assignable to the Conductor port's narrower `TranscriptTurn` (role+text only) — no conversion needed.
export interface TranscriptEntry {
  readonly role: 'interviewer' | 'candidate'
  readonly text: string
  readonly attemptId: string
}

export interface SessionView {
  readonly answerCorrections?: readonly (AnswerCorrection & { at: string })[]
  readonly findingReviews?: readonly (FindingReview & { at: string })[]
  readonly supersededFindings?: ReadonlyMap<string, string>
  readonly historicalFindings?: readonly Finding[]
  readonly supersededAttempts?: ReadonlyMap<string, string>
  readonly sessionId: string
  readonly session: Session | null
  readonly state: SessionState
  readonly sources: ReadonlyMap<string, string>
  readonly claims: ReadonlyMap<string, Claim>
  readonly spans: ReadonlyMap<string, Span>
  readonly evidence: ReadonlyMap<string, Evidence>
  readonly artifacts: ReadonlyMap<string, Artifact>
  readonly round: RoundKind | null
  readonly snapshot: Snapshot | null
  readonly tombstones: readonly SnapshotTombstone[]
  readonly delivery: readonly DeliveryReport[]
  readonly prosody: readonly ProsodyReport[]
  readonly kinematics: readonly KinematicsReport[]
  readonly confirmedClaimIds: ReadonlySet<string>
  readonly transcript: readonly TranscriptEntry[]
  readonly attempts: ReadonlyMap<string, AttemptRecord>
  // The subjects END_TOPIC moved the session on to, in order.
  readonly handoffs: readonly string[]
  readonly findings: readonly Finding[]
  readonly gaps: ReadonlyMap<string, GapEntry>
  readonly pressureLevel: number
  readonly invocations: readonly InvocationRecord[]
  readonly totals: { readonly costUsd: number; readonly tokens: number }
  readonly closed: { readonly reason: string } | null
}

function unhandled(value: never, what: string): never {
  throw new Error(`replay: unhandled ${what} ${JSON.stringify(value)}`)
}

// A pure ordered fold — same events always produce the same view — so a session is re-derived, not stored.
export function replay(events: readonly AnyEvent[]): SessionView {
  const sessionId = events[0]?.sessionId ?? ''
  const sources = new Map<string, string>()
  const claims = new Map<string, Claim>()
  const spans = new Map<string, Span>()
  const evidence = new Map<string, Evidence>()
  const artifacts = new Map<string, Artifact>()
  let round: RoundKind | null = null
  let snapshot: Snapshot | null = null
  const tombstones: SnapshotTombstone[] = []
  const delivery: DeliveryReport[] = []
  const prosody: ProsodyReport[] = []
  const kinematics: KinematicsReport[] = []
  const confirmedClaimIds = new Set<string>()
  const transcript: TranscriptEntry[] = []
  const attempts = new Map<string, AttemptRecord>()
  const handoffs: string[] = []
  const findings: Finding[] = []
  const answerCorrections: (AnswerCorrection & { at: string })[] = []
  const findingReviews: (FindingReview & { at: string })[] = []
  const supersededFindings = new Map<string, string>()
  const revisions = new Map<string, number>()
  const requests = new Map<string, string>()
  const gaps = new Map<string, GapEntry>()
  const invocations: InvocationRecord[] = []
  let session: Session | null = null
  let state: SessionState = 'selecting'
  let pressureLevel = 0
  let closed: { reason: string } | null = null

  for (const [position, event] of events.entries()) {
    // Gapless from 0 — a hole means a lost event or an edited log, not a session that happened this way.
    if (event.seq !== position) {
      throw new Error(
        `replay: expected seq ${position} at position ${position}, found ${event.seq} (${event.eventId}); the log is not gapless`,
      )
    }
    if (event.sessionId !== sessionId) {
      throw new Error(
        `replay: ${event.eventId} belongs to session ${event.sessionId}, not ${sessionId}`,
      )
    }

    switch (event.kind) {
      case 'plan': {
        // The chosen action arrives as its own policy_action event, so a considered-but-rejected
        // action never leaks into state; only the hand-off is read here. Logs written before topics
        // existed name it `nextClaimId`.
        const next = event.payload.nextSubjectId ?? event.payload.nextClaimId
        if (next !== undefined) handoffs.push(next)
        break
      }

      case 'policy_action': {
        const { attemptId, action, pressureLevel: level, claimId, topicId } = event.payload
        attempts.set(attemptId, {
          id: attemptId,
          action,
          pressureLevel: level,
          questionEventId: null,
          ...(claimId === undefined ? {} : { claimId }),
          ...(topicId === undefined ? {} : { topicId }),
        })
        break
      }

      case 'question': {
        const attempt = attempts.get(event.payload.attemptId)
        if (attempt !== undefined) {
          attempts.set(attempt.id, { ...attempt, questionEventId: event.eventId })
        }
        transcript.push({
          role: 'interviewer',
          text: event.payload.text,
          attemptId: event.payload.attemptId,
        })
        invocations.push(event.payload.invocation)
        break
      }

      case 'answer':
        revisions.set(event.payload.attemptId, 1)
        sources.set(event.payload.sourceId, event.payload.text)
        transcript.push({
          role: 'candidate',
          text: event.payload.text,
          attemptId: event.payload.attemptId,
        })
        break

      case 'observation':
        // Noticed, not judged (CONTEXT.md) — carries no verdict, so no state derives from it here.
        break

      case 'evaluation':
        // Safe cast: the schema's `minItems: 1` is the runtime half of `Finding`'s tuple type.
        findings.push(...(event.payload.findings as unknown as readonly Finding[]))
        for (const span of event.payload.spans) spans.set(span.id, span)
        for (const link of event.payload.evidence) evidence.set(link.id, link)
        invocations.push(event.payload.invocation)
        break

      case 'state_change': {
        const change = event.payload
        switch (change.change) {
          case 'answer_corrected': {
            const receipt = JSON.stringify(change)
            if (requests.has(change.requestId)) {
              if (requests.get(change.requestId) !== receipt)
                throw new Error('Correction request collision')
              break
            }
            if (
              revisions.get(change.attemptId) !== change.previousRevision ||
              change.revision !== change.previousRevision + 1
            )
              throw new Error('Correction revision conflict')
            const index = transcript.findLastIndex(
              (turn) => turn.role === 'candidate' && turn.attemptId === change.attemptId,
            )
            if (index < 0 || sources.has(change.sourceId))
              throw new Error('Correction source is invalid')
            requests.set(change.requestId, receipt)
            revisions.set(change.attemptId, change.revision)
            sources.set(change.sourceId, change.text)
            transcript[index] = {
              role: 'candidate',
              attemptId: change.attemptId,
              text: change.text,
            }
            for (const finding of findings)
              if (finding.attemptId === change.attemptId)
                supersededFindings.set(finding.id, event.occurredAt)
            answerCorrections.push({ ...change, at: event.occurredAt })
            break
          }
          case 'finding_reviewed': {
            const receipt = JSON.stringify(change)
            if (requests.has(change.requestId)) {
              if (requests.get(change.requestId) !== receipt)
                throw new Error('Feedback request collision')
              break
            }
            if (!findings.some((finding) => finding.id === change.findingId))
              throw new Error('Review finding is missing')
            if (change.state === 'confirmed_error' && change.sourceRefs.length === 0)
              throw new Error('Reviewed error requires a source reference')
            if (supersededFindings.has(change.findingId) && change.state !== 'confirmed_error')
              throw new Error('Superseded feedback cannot be reinstated by review')
            requests.set(change.requestId, receipt)
            findingReviews.push({ ...change, at: event.occurredAt })
            if (change.state === 'confirmed_error')
              supersededFindings.set(change.findingId, event.occurredAt)
            break
          }
          case 'practice_assistance':
          case 'preparation_saved':
          case 'preparation_goals_saved':
          case 'story_saved':
          case 'practice_plan_saved':
            break
          case 'session_started':
            session = change.session
            pressureLevel = change.session.pressureLevel
            break

          case 'session_state':
            state = change.to
            break

          case 'source_registered':
            sources.set(change.sourceId, change.text)
            break

          case 'claims_extracted':
            for (const span of change.spans) spans.set(span.id, span)
            for (const claim of change.claims) {
              claims.set(claim.id, claim)
              if (claim.confirmedByCandidate) confirmedClaimIds.add(claim.id)
            }
            invocations.push(change.invocation)
            break

          case 'claim_confirmed': {
            if (change.confirmed) confirmedClaimIds.add(change.claimId)
            else confirmedClaimIds.delete(change.claimId)
            const claim = claims.get(change.claimId)
            if (claim !== undefined) {
              // §4.1: an edited assertion overwrites the claim, so what's interrogated is what they agreed to.
              claims.set(claim.id, {
                ...claim,
                confirmedByCandidate: change.confirmed,
                ...(change.editedAssertion === undefined
                  ? {}
                  : { assertion: change.editedAssertion }),
              })
            }
            break
          }

          case 'pressure_level':
            pressureLevel = change.to
            break

          case 'gap_opened':
            gaps.set(change.gap.id, change.gap)
            break

          case 'practice_outcome': {
            const gap = gaps.get(change.gapId)
            if (gap === undefined)
              throw new Error(`practice outcome refers to missing gap ${change.gapId}`)
            const result = applyPracticeOutcome({
              gap,
              outcome: { ...change, occurredAt: event.occurredAt },
            })
            if (result.kind === 'rejected') throw new PracticeOutcomeError(result.failure)
            gaps.set(gap.id, result.gap)
            break
          }

          case 'gap_status': {
            const gap = gaps.get(change.gapId)
            if (gap !== undefined) {
              gaps.set(gap.id, {
                ...gap,
                status: change.to,
                lastTouchedAt: event.occurredAt,
                // §4.6: a non-empty transfer list licenses `closed_under_transfer`; this is the only
                // event that links an attempt to a gap.
                transferAttemptIds:
                  change.to === 'closed_under_transfer' &&
                  change.attemptId !== undefined &&
                  !gap.transferAttemptIds.includes(change.attemptId)
                    ? [...gap.transferAttemptIds, change.attemptId]
                    : gap.transferAttemptIds,
              })
            }
            break
          }

          case 'round_started':
            round = change.kind
            if (change.briefInvocation !== undefined) invocations.push(change.briefInvocation)
            break

          case 'snapshot_pinned':
            snapshot = change.snapshot
            for (const artifact of change.artifacts) artifacts.set(artifact.id, artifact)
            for (const link of change.evidence) evidence.set(link.id, link)
            break

          case 'snapshot_deleted':
            tombstones.push(change.tombstone)
            break

          case 'delivery_recorded':
            delivery.push(change.report)
            break

          case 'prosody_recorded':
            prosody.push(change.report)
            break

          case 'kinematics_recorded':
            kinematics.push(change.report)
            break

          case 'ceiling_breach':
            // Recorded so the session can say why it stopped; the enforcing ledger isn't rebuilt here.
            break

          case 'session_closed':
            closed = { reason: change.reason }
            state = 'closed'
            break

          default:
            unhandled(change, 'state change')
        }
        break
      }

      default:
        unhandled(event, 'event kind')
    }
  }

  const supersededAttempts = new Map(
    findings.flatMap((finding) =>
      supersededFindings.has(finding.id)
        ? [[finding.attemptId, supersededFindings.get(finding.id)!] as const]
        : [],
    ),
  )
  const totals = invocations.reduce(
    (running, invocation) => ({
      costUsd: running.costUsd + invocation.costUsd,
      tokens: running.tokens + invocation.inputTokens + invocation.outputTokens,
    }),
    { costUsd: 0, tokens: 0 },
  )

  return {
    sessionId,
    session,
    state,
    sources,
    claims,
    spans,
    evidence,
    artifacts,
    round,
    snapshot,
    tombstones,
    delivery,
    prosody,
    kinematics,
    confirmedClaimIds,
    transcript,
    attempts,
    handoffs,
    findings: findings.filter((finding) => !supersededFindings.has(finding.id)),
    historicalFindings: findings,
    answerCorrections,
    findingReviews,
    supersededFindings,
    supersededAttempts,
    gaps: invalidateGaps(gaps, supersededFindings, supersededAttempts),
    pressureLevel,
    invocations,
    totals,
    closed,
  }
}

function invalidateGaps(
  gaps: ReadonlyMap<string, GapEntry>,
  superseded: ReadonlyMap<string, string>,
  attempts: ReadonlyMap<string, string> = new Map(),
): Map<string, GapEntry> {
  return new Map(
    [...gaps].map(([id, gap]) => {
      const invalidated = gap.findingIds.flatMap((finding) =>
        superseded.has(finding) ? [superseded.get(finding)!] : [],
      )
      for (const attemptId of [
        ...gap.transferAttemptIds,
        ...(gap.practiceReceipts ?? []).map((receipt) => receipt.attemptId),
      ]) {
        const at = attempts.get(attemptId)
        if (at !== undefined) invalidated.push(at)
      }
      return [
        id,
        invalidated.length === 0
          ? gap
          : {
              ...gap,
              status: 'unverified' as const,
              evidenceIds: [],
              summary: 'Previous feedback was superseded; reassessment is required.',
              lastTouchedAt: [gap.lastTouchedAt, ...invalidated].sort().at(-1)!,
            },
      ]
    }),
  )
}

export function gapsAcrossViews(views: readonly SessionView[]): Map<string, GapEntry> {
  const gaps = new Map<string, GapEntry>()
  const superseded = new Map<string, string>()
  const attempts = new Map<string, string>()
  for (const view of views) {
    for (const [id, at] of view.supersededFindings ?? [])
      if (at > (superseded.get(id) ?? '')) superseded.set(id, at)
    for (const [id, at] of view.supersededAttempts ?? [])
      if (at > (attempts.get(id) ?? '')) attempts.set(id, at)
    for (const [id, gap] of view.gaps) {
      const known = gaps.get(id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(id, gap)
    }
  }
  return invalidateGaps(gaps, superseded, attempts)
}
