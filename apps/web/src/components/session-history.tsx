import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { ROUND_LABEL, useTopicCatalog } from '../lib/catalog.ts'
import { day, words } from '../lib/format.ts'
import { Empty, Failed, Loading, Tag } from './primitives.tsx'
import { JourneyIcon } from './journey.tsx'

const AVAILABILITY = {
  awaiting_answer: 'In progress',
  processing: 'Finishing a turn',
  closed: 'Completed',
  interrupted: 'Interrupted · transcript saved',
} as const

const LINK =
  'ring-focus rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-accent-soft hover:border-edge-strong'

export type HistoryFilter = 'all' | 'active' | 'completed' | 'interrupted'

type SavedInterview = Awaited<ReturnType<typeof api.sessions>>['sessions'][number]
export function canViewDebrief({ session, availability }: SavedInterview): boolean {
  return (
    session.mode !== 'simulation' ||
    (availability !== 'awaiting_answer' && availability !== 'processing')
  )
}

export function SessionHistory({
  limit,
  filter = 'all',
}: { limit?: number; filter?: HistoryFilter } = {}) {
  const history = useQuery({ queryKey: ['sessions'], queryFn: api.sessions })
  const catalog = useTopicCatalog()

  if (history.isLoading) return <Loading what="your interviews" />
  if (history.isError) return <Failed error={history.error} />
  if (history.data === undefined) return null
  if (history.data.sessions.length === 0) {
    return (
      <Empty>
        No interviews yet.{' '}
        <Link to="/session" className="text-accent-soft underline underline-offset-2">
          Start an interview
        </Link>{' '}
        and its questions, answers and feedback will appear here.
      </Empty>
    )
  }

  const sessions = history.data.sessions
    .filter(
      (entry) =>
        filter === 'all' ||
        (filter === 'active' &&
          (entry.availability === 'awaiting_answer' || entry.availability === 'processing')) ||
        (filter === 'completed' && entry.availability === 'closed') ||
        (filter === 'interrupted' && entry.availability === 'interrupted'),
    )
    .slice(0, limit)
  if (sessions.length === 0)
    return (
      <Empty>No interviews in this view. Choose another filter to see your saved sessions.</Empty>
    )

  return (
    <div className="space-y-3">
      {sessions.map(({ session, answerCount, availability }) => {
        const role = catalog.data?.roles.find((entry) => entry.id === session.roleId)
        const id = encodeURIComponent(session.id)
        const active = availability === 'awaiting_answer' || availability === 'processing'
        const debriefAvailable = canViewDebrief({ session, answerCount, availability })
        return (
          <article key={session.id} className="history-card has-stamp">
            <div className="history-stamp">
              <time dateTime={session.startedAt}>{day(session.startedAt)}</time>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="journey-icon mt-0.5">
                  <JourneyIcon name="interview" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-body">
                    {role?.label ?? words(session.roleId ?? 'technical_interview')}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {session.rounds.map((round) => ROUND_LABEL[round]).join(' → ')}
                  </p>
                  <p className="mt-1 text-xs text-quiet">
                    {words(session.level)}
                    {' · '}
                    {words(session.mode)}
                  </p>
                </div>
              </div>
              <Tag tone={availability === 'interrupted' ? 'shaky' : active ? 'accent' : 'quiet'}>
                {AVAILABILITY[availability]}
              </Tag>
            </div>
            <div className="history-card-footer mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge/70 pt-4">
              <p className="text-xs text-quiet">
                {answerCount} answer{answerCount === 1 ? '' : 's'} recorded
              </p>
              <div className="history-card-actions flex flex-wrap gap-2">
                {availability === 'awaiting_answer' ? (
                  <Link to={`/session?id=${id}`} className={LINK}>
                    Continue interview
                  </Link>
                ) : (
                  <Link to={`/replay?id=${id}`} className={LINK}>
                    Replay interview
                  </Link>
                )}
                {debriefAvailable && (
                  <Link
                    to={`/debrief?id=${id}${filter === 'all' ? '' : `&historyFilter=${filter}`}`}
                    className={LINK}
                  >
                    View debrief
                  </Link>
                )}
              </div>
            </div>
            {!debriefAvailable && (
              <p className="mt-2 text-xs text-quiet">
                Finish the simulation to open its full debrief.
              </p>
            )}
            {availability === 'interrupted' && (
              <p className="mt-2 text-xs text-quiet">
                This interview cannot continue on this server. Its saved answers and partial
                feedback remain available.
              </p>
            )}
          </article>
        )
      })}
    </div>
  )
}
