import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { Button, Failed, Loading, Tag } from './primitives.tsx'

export function FeedbackAudit({ sessionId }: { sessionId: string }) {
  const cache = useQueryClient()
  const audit = useQuery({
    queryKey: ['feedback', sessionId],
    queryFn: () => api.feedback(sessionId),
  })
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId),
  })
  const [attemptId, setAttemptId] = useState('')
  const [findingId, setFindingId] = useState('')
  const [reason, setReason] = useState('')
  const [sources, setSources] = useState('')
  const refresh = async () => {
    await Promise.all(
      ['feedback', 'session', 'debrief', 'ledger', 'schedule', 'review'].map((key) =>
        cache.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  const review = useMutation({
    mutationFn: (state: 'pending' | 'upheld' | 'confirmed_error') =>
      api.reviewFinding(sessionId, {
        requestId: crypto.randomUUID(),
        findingId,
        state,
        reason: reason.trim(),
        sourceRefs: sources
          .split('\n')
          .map((source) => source.trim())
          .filter(Boolean),
      }),
    onSuccess: refresh,
  })
  if (audit.isPending || session.isPending) return <Loading what="feedback audit" />
  if (audit.isError) return <Failed error={audit.error} />
  if (session.isError) return <Failed error={session.error} />
  const answers = session.data.transcript.filter((turn) => turn.role === 'candidate')
  const selected = answers.find((answer) => answer.attemptId === attemptId) ?? answers[0]
  const revision =
    audit.data.corrections
      .filter((correction) => correction.attemptId === selected?.attemptId)
      .at(-1)?.revision ?? 1
  const findings = audit.data.historicalFindings
  return (
    <details className="card p-5">
      <summary className="cursor-pointer text-sm font-medium">
        Correct a transcript or review feedback
      </summary>
      <p className="mt-3 text-xs text-quiet">
        Changes append to the record. Original words and findings remain available. Candidate
        self-review is not independent adjudication.
      </p>
      {audit.data.pendingReassessment && (
        <p role="status" className="mt-3 text-sm">
          Previous feedback was superseded. Corrected evidence has not been reassessed.
        </p>
      )}
      {selected !== undefined && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs">
            Accepted answer
            <select
              aria-label="Accepted answer"
              className="journey-select mt-2"
              value={selected.attemptId}
              onChange={(event) => setAttemptId(event.target.value)}
            >
              {answers.map((answer, index) => (
                <option key={answer.attemptId} value={answer.attemptId}>
                  Answer {index + 1} · {answer.attemptId}
                </option>
              ))}
            </select>
          </label>
          <CorrectionForm
            key={`${selected.attemptId}:${revision}`}
            sessionId={sessionId}
            attemptId={selected.attemptId}
            revision={revision}
            initial={selected.text}
            refresh={refresh}
          />
        </div>
      )}
      {findings.length > 0 && (
        <div className="mt-6 space-y-3">
          <label className="block text-xs">
            Finding to review
            <select
              aria-label="Finding to review"
              className="journey-select mt-2"
              value={findingId}
              onChange={(event) => setFindingId(event.target.value)}
            >
              <option value="">Choose a finding</option>
              {findings
                .filter((finding) => !audit.data.supersededFindingIds.includes(finding.id))
                .map((finding) => (
                  <option key={finding.id} value={finding.id}>
                    {finding.rationale}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs">
            Review reason
            <textarea
              aria-label="Review reason"
              className="mt-2 w-full rounded border border-edge bg-ink-2 p-3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="block text-xs">
            Source references, one per line
            <textarea
              aria-label="Review sources"
              className="mt-2 w-full rounded border border-edge bg-ink-2 p-3"
              value={sources}
              onChange={(event) => setSources(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!findingId || !reason.trim() || review.isPending}
              onClick={() => review.mutate('pending')}
            >
              Flag for review
            </Button>
            <Button
              disabled={!findingId || !reason.trim() || review.isPending}
              onClick={() => review.mutate('upheld')}
            >
              Keep finding after review
            </Button>
            <Button
              disabled={!findingId || !reason.trim() || !sources.trim() || review.isPending}
              onClick={() => review.mutate('confirmed_error')}
            >
              Mark reviewed error
            </Button>
          </div>
          {review.isError && <Failed error={review.error} />}
          {audit.data.reviews.map((item) => (
            <p key={item.requestId} className="text-xs">
              <Tag>{item.state.replace(/_/g, ' ')}</Tag> {item.reason} · candidate self-review
            </p>
          ))}
        </div>
      )}
      {audit.data.corrections.map((item) => (
        <p key={item.requestId} className="mt-3 text-xs">
          Answer revision {item.revision}: {item.reason}
        </p>
      ))}
      {findings
        .filter((finding) => audit.data.supersededFindingIds.includes(finding.id))
        .map((finding) => (
          <article key={finding.id} className="mt-3 border-t border-edge pt-3 text-xs">
            <Tag>Superseded feedback</Tag> {finding.rationale}
            <p className="mt-1 text-quiet">
              {finding.modelVersion} · rubric {finding.rubric.id} v{finding.rubric.version}
            </p>
          </article>
        ))}
    </details>
  )
}

function CorrectionForm({
  sessionId,
  attemptId,
  revision,
  initial,
  refresh,
}: {
  sessionId: string
  attemptId: string
  revision: number
  initial: string
  refresh: () => Promise<void>
}) {
  const [text, setText] = useState(initial)
  const [reason, setReason] = useState('')
  const request = useRef<{ signature: string; id: string } | null>(null)
  const correction = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([text, reason, revision])
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() }
      return api.correctAnswer(sessionId, {
        attemptId,
        previousRevision: revision,
        text,
        reason: reason.trim(),
        requestId: request.current.id,
      })
    },
    onSuccess: refresh,
  })
  return (
    <div className="space-y-3">
      <label className="block text-xs">
        Corrected transcript · revision {revision}
        <textarea
          aria-label="Corrected transcript"
          className="mt-2 w-full rounded border border-edge bg-ink-2 p-3"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="block text-xs">
        Correction reason
        <input
          aria-label="Correction reason"
          className="mt-2 w-full rounded border border-edge bg-ink-2 p-3"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Button
        disabled={text === initial || !reason.trim() || correction.isPending}
        onClick={() => correction.mutate()}
      >
        Save transcript correction
      </Button>
      {correction.isError && <Failed error={correction.error} />}
    </div>
  )
}
