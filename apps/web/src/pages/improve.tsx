import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { JourneyIcon, JourneyLink, PageIntro } from '../components/journey.tsx'
import { Empty, Failed, Loading, Tag } from '../components/primitives.tsx'
import { canViewDebrief, SessionHistory } from '../components/session-history.tsx'
import { ROUND_LABEL, useTopicById } from '../lib/catalog.ts'
import { words } from '../lib/format.ts'

export function ImprovePage() {
  const [params] = useSearchParams()
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: api.ledger })
  const schedule = useQuery({ queryKey: ['schedule', 7], queryFn: () => api.schedule(7) })
  const topicById = useTopicById()
  const gaps = ledger.data?.gaps.filter((gap) => gap.status !== 'closed_under_transfer') ?? []
  const sessionId = params.get('id')
  const history = useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions,
    refetchOnMount: 'always',
  })
  const blocked = history.data?.sessions.find((entry) => !canViewDebrief(entry))
  const feedbackReady = history.isSuccess && !history.isFetching && blocked === undefined
  const selected = history.data?.sessions.find((entry) => entry.session.id === sessionId)
  const rounds = schedule.data?.suggestedRounds ?? []
  return (
    <div className="journey-page studio-improve">
      <PageIntro
        eyebrow="Improve / From evidence to practice"
        title="Improve"
        displayTitle={
          <>
            Know what needs work.
            <br />
            Make the next attempt count.
          </>
        }
        description="Start with what your answers showed. Choose a focused next round, then check what changes."
        action={
          <Link to="/prepare" className="journey-secondary">
            Prepare an interview <JourneyIcon name="arrow" className="size-4" />
          </Link>
        }
      />
      {selected !== undefined && canViewDebrief(selected) && (
        <JourneyLink
          to={`/debrief?id=${encodeURIComponent(selected.session.id)}`}
          title="Return to this interview's feedback"
          description="Keep the findings and their source interview in view."
          icon="file"
        />
      )}
      {history.isError && <Failed error={history.error} />}
      {history.isFetching && <Loading what="feedback availability" />}
      {blocked !== undefined && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold">A simulation is in progress</h2>
          <p className="mt-2 text-xs text-quiet">
            Finish the simulation before reviewing new findings and practice suggestions. Other
            available session reports remain below.
          </p>
          <Link
            to={`/session?id=${encodeURIComponent(blocked.session.id)}`}
            className="journey-secondary mt-4"
          >
            Return to simulation
          </Link>
        </section>
      )}
      <div className="improve-layout">
        <div className="space-y-6">
          {feedbackReady && (
            <section className="practice-sheet">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Evidence-backed areas to practise</h2>
                <Link to="/ledger" className="text-xs font-medium text-accent-soft">
                  Open gap ledger
                </Link>
              </div>
              {ledger.isLoading && <Loading what="your practice areas" />}
              {ledger.isError && <Failed error={ledger.error} />}
              {ledger.data !== undefined && gaps.length === 0 && (
                <Empty>
                  <JourneyIcon name="improve" className="mx-auto mb-3 size-7 text-quiet" />
                  No open practice areas are recorded.{' '}
                  <Link to="/session" className="text-accent-soft underline underline-offset-2">
                    Start an interview
                  </Link>{' '}
                  to build an evidence-backed picture.
                </Empty>
              )}
              <div className="divide-y divide-edge">
                {gaps.map((gap) => {
                  const topic = topicById(gap.topicId)
                  const quotes = gap.evidenceIds.flatMap((id) => {
                    const quote = ledger.data?.quotes.find((entry) => entry.evidenceId === id)
                    return quote === undefined ? [] : [quote.quoted]
                  })
                  return (
                    <article key={gap.id} className="py-5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag tone={gap.status === 'unverified' ? 'quiet' : 'shaky'}>
                          {gap.status === 'unverified'
                            ? 'Not yet judged'
                            : gap.status === 'drilled'
                              ? 'Transfer pending'
                              : 'Needs practice'}
                        </Tag>
                        <span className="text-xs text-quiet">
                          {topic?.title ?? words(gap.competency)}
                        </span>
                      </div>
                      <h3 className="mt-3 text-sm font-medium leading-relaxed text-body">
                        {gap.summary}
                      </h3>
                      {quotes.map((quote, index) => (
                        <blockquote
                          key={index}
                          className="mt-3 border-l-2 border-accent/40 pl-3 text-xs leading-relaxed text-muted"
                        >
                          “{quote}”
                        </blockquote>
                      ))}
                      <p className="mt-3 text-[11px] text-quiet">
                        {gap.status === 'unverified'
                          ? 'An abstention is not a weakness or a pass. Gather more evidence.'
                          : gap.status === 'drilled'
                            ? 'The drill held. A separate transfer attempt is still needed to close this gap.'
                            : 'Review the evidence, then choose a round that covers this area.'}
                      </p>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
          <section className="feedback-archive">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Recent interview feedback</h2>
              <Link to="/history" className="text-xs font-medium text-accent-soft">
                View all history
              </Link>
            </div>
            <SessionHistory limit={3} />
          </section>
        </div>
        <aside className="space-y-5 improve-side">
          {feedbackReady && (
            <section className="practice-plan">
              <span className="journey-icon">
                <JourneyIcon name="clock" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">Your next practice</h2>
              <p className="mt-2 text-xs leading-relaxed text-quiet">
                The schedule uses recorded gaps and retrieval history to suggest what comes next.
              </p>
              {schedule.isLoading && <Loading what="the practice schedule" />}
              {schedule.isError && <Failed error={schedule.error} />}
              {rounds.length > 0 ? (
                <>
                  <ul className="mt-5 space-y-3">
                    {rounds.map((round) => (
                      <li key={round} className="flex items-center gap-2 text-sm text-muted">
                        <JourneyIcon name="check" className="size-4 text-accent-soft" />
                        {ROUND_LABEL[round]}
                      </li>
                    ))}
                  </ul>
                  <Link to={`/session?rounds=${rounds.join(',')}`} className="journey-primary mt-6">
                    Practise suggested rounds <JourneyIcon name="arrow" className="size-4" />
                  </Link>
                  <p className="mt-3 text-[11px] leading-relaxed text-quiet">
                    This opens round setup. It does not launch a drill for a selected gap.
                  </p>
                </>
              ) : (
                schedule.data !== undefined && (
                  <p className="mt-5 text-sm text-muted">
                    No practice is scheduled in the next seven days.
                  </p>
                )
              )}
              <Link
                to="/schedule"
                className="mt-4 inline-flex text-xs font-medium text-accent-soft"
              >
                Review your practice schedule
              </Link>
            </section>
          )}
          <JourneyLink
            to="/review"
            title="See what changed"
            description="Compare attempts using the answers and findings on record."
            icon="history"
          />
          <div className="journey-assurance">
            <JourneyIcon name="shield" className="size-4 shrink-0" />
            <p>A drill is practice. Only an independent Transfer attempt can close a gap.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
