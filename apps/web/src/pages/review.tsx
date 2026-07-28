import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { EvidenceProvider } from '../components/evidence.tsx'
import { FindingCard } from '../components/finding-card.tsx'
import { Empty, Failed, Loading, Panel, Tag } from '../components/primitives.tsx'
import { day } from '../lib/format.ts'

export function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const subject = params.get('subject') ?? undefined
  const review = useQuery({
    queryKey: ['review', subject ?? null],
    queryFn: () => api.review(subject),
  })

  return (
    <EvidenceProvider>
      <div className="space-y-4">
        <Panel
          title="Review"
          subtitle="Attempts side by side, oldest first. What changed is visible in evidence; nothing is averaged over it."
          actions={
            subject === undefined ? undefined : (
              <button
                onClick={() => setParams({})}
                className="text-xs text-accent underline underline-offset-2"
              >
                show every subject
              </button>
            )
          }
        >
          {review.isLoading && <Loading what="past attempts" />}
          {review.isError && <Failed error={review.error} />}
          {review.data !== undefined && review.data.subjects.length === 0 && (
            <Empty>Nothing to review yet — run a session first.</Empty>
          )}
          {review.data !== undefined && (
            <div className="space-y-2 text-xs text-quiet">
              <span>
                citations: {review.data.citations.resolved} resolved ·{' '}
                {review.data.citations.unresolvable} unresolvable ·{' '}
                {review.data.citations.snapshotDeleted} pointing at a deleted snapshot ·{' '}
                {review.data.citations.notInThisSession} into a source this session does not carry
              </span>
            </div>
          )}
        </Panel>

        {review.data?.subjects.map((entry) => (
          <Panel key={entry.subject} title={entry.subject}>
            <div className="space-y-3">
              {entry.attempts.map((attempt, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{day(attempt.at)}</Tag>
                    <button
                      onClick={() => setParams({ subject: entry.subject })}
                      className="text-[11px] text-quiet underline underline-offset-2"
                    >
                      {attempt.sessionId}
                    </button>
                  </div>
                  <FindingCard finding={attempt.finding} quotes={review.data?.quotes ?? []} />
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </EvidenceProvider>
  )
}
