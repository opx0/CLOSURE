import { FeedbackAudit } from '../components/feedback-audit.tsx'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { CompetenceLaneView } from '../components/competence-lane.tsx'
import { PerformanceLaneView } from '../components/performance-lane.tsx'
import { Lane } from '../components/lane.tsx'
import { Failed, Loading } from '../components/primitives.tsx'
import {
  canViewDebrief,
  SessionHistory,
  EndInterruptedInterview,
} from '../components/session-history.tsx'
import { day } from '../lib/format.ts'
import { JourneyIcon, JourneyLink, PageIntro } from '../components/journey.tsx'

export function DebriefPage() {
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('id')
  const lane = params.get('lane') === 'performance' ? 'performance' : 'competence'
  const setLane = (value: 'competence' | 'performance') =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === 'competence') next.delete('lane')
      else next.set('lane', value)
      return next
    })
  const history = useQuery({
    queryKey: ['sessions'],
    queryFn: api.sessions,
    enabled: sessionId !== null,
    refetchOnMount: 'always',
  })
  const selected = history.data?.sessions.find((entry) => entry.session.id === sessionId)
  const available =
    history.isSuccess && !history.isFetching && (selected === undefined || canViewDebrief(selected))

  const debrief = useQuery({
    queryKey: ['debrief', sessionId],
    queryFn: () => api.debrief(sessionId ?? ''),
    enabled: sessionId !== null && available,
  })
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId ?? ''),
    enabled: sessionId !== null && available,
  })

  if (sessionId === null) {
    return (
      <div className="journey-page">
        <PageIntro
          eyebrow="Feedback in context"
          title="Choose an interview"
          description="Open saved feedback with the conversation it came from."
        />
        <SessionHistory />
      </div>
    )
  }
  if (history.isError) return <Failed error={history.error} />
  if (history.isFetching || history.isPending) return <Loading what="feedback availability" />
  if (selected !== undefined && !canViewDebrief(selected))
    return (
      <div className="journey-page">
        <PageIntro
          eyebrow={
            selected.availability === 'interrupted'
              ? 'Simulation interrupted'
              : 'Simulation in progress'
          }
          title="Debrief"
          description={
            selected.availability === 'interrupted'
              ? 'End the interrupted interview to review saved work. Unfinished answers will not be graded.'
              : 'Feedback is held until the round ends. Finish this interview to open its full saved report.'
          }
        />
        {selected.availability === 'interrupted' ? (
          <EndInterruptedInterview sessionId={selected.session.id} />
        ) : (
          <Link
            to={`/session?id=${encodeURIComponent(selected.session.id)}`}
            className="journey-primary self-start"
          >
            Return to simulation
          </Link>
        )}
      </div>
    )
  if (debrief.isPending) return <Loading what="the debrief" />
  if (debrief.isError) return <Failed error={debrief.error} />
  const data = debrief.data
  if (data === undefined) return null

  return (
    <div className="journey-page studio-debrief">
      <Link
        to={
          ['active', 'completed', 'interrupted'].includes(params.get('historyFilter') ?? '')
            ? `/history?filter=${params.get('historyFilter')}`
            : '/history'
        }
        className="text-xs font-medium text-accent-soft"
      >
        Back to history
      </Link>
      <PageIntro
        eyebrow="The words behind the finding"
        title="Debrief"
        displayTitle={
          <>
            The answer.
            <br />
            <em>The evidence.</em>
          </>
        }
        description={`Feedback grounded in this interview. Generated ${day(data.generatedAt)}.`}
        action={
          <Link
            to={`/replay?id=${encodeURIComponent(sessionId ?? data.sessionId)}`}
            className="journey-secondary"
          >
            Transcript &amp; evidence <JourneyIcon name="arrow" className="size-4" />
          </Link>
        }
      />
      <JourneyLink
        to={`/improve?id=${encodeURIComponent(data.sessionId)}`}
        title="Choose your next practice"
        description="Review recorded gaps and the rounds your schedule suggests."
        icon="improve"
      />
      {session.data?.session?.story !== undefined && (
        <details className="card p-5">
          <summary className="cursor-pointer text-sm font-medium">
            Confirmed story · version {session.data.session.story.revision}
          </summary>
          <p className="mt-3 text-sm">
            <strong>Situation:</strong> {session.data.session.story.situation}
          </p>
          <p className="mt-2 text-sm">
            <strong>Action:</strong> {session.data.session.story.action}
          </p>
          <p className="mt-2 text-sm">
            <strong>Result:</strong> {session.data.session.story.result}
          </p>
          <p className="mt-2 text-xs text-quiet">
            This is your confirmed story, not an independently verified fact.
          </p>
        </details>
      )}
      <div className="report-note">
        <h2 className="mb-2 text-sm font-medium">Read each lane on its own</h2>
        <p className="text-sm text-quiet">
          Answer feedback is about what your words demonstrated. Delivery observations describe how
          you spoke. A delivery measurement never becomes a competence finding.
        </p>
      </div>

      <div className="journey-segment debrief-lane-tabs max-w-lg" aria-label="Debrief lane">
        <button
          type="button"
          aria-pressed={lane === 'competence'}
          onClick={() => setLane('competence')}
        >
          Answer feedback
        </button>
        <button
          type="button"
          aria-pressed={lane === 'performance'}
          onClick={() => setLane('performance')}
        >
          Delivery observations
        </button>
      </div>
      {lane === 'competence' ? (
        <>
          <Lane kind="competence">
            <CompetenceLaneView lane={data.competence} />
          </Lane>
          <FeedbackAudit sessionId={sessionId} />
          <details className="card p-5">
            <summary className="cursor-pointer text-sm font-medium">
              Words cited in this interview
            </summary>
            {session.isLoading && <Loading what="the cited words" />}
            {session.isError && <Failed error={session.error} />}
            {session.data?.quotes.map((quote) => (
              <blockquote
                key={quote.evidenceId}
                className="mt-4 border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-muted"
              >
                “{quote.quoted}”
                <span className="mono mt-1 block text-[10px] text-quiet">{quote.evidenceId}</span>
              </blockquote>
            ))}
            {session.data?.quotes.length === 0 && (
              <p className="mt-4 text-xs text-quiet">
                No cited words were recorded for this interview.
              </p>
            )}
          </details>
        </>
      ) : (
        <Lane kind="performance">
          <PerformanceLaneView lane={data.performance} />
        </Lane>
      )}
    </div>
  )
}
