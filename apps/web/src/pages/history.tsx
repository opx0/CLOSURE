import { Link, useSearchParams } from 'react-router-dom'
import { JourneyIcon, JourneyLink, PageIntro } from '../components/journey.tsx'
import { SessionHistory, type HistoryFilter } from '../components/session-history.tsx'

const FILTERS: readonly { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All interviews' },
  { value: 'active', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'interrupted', label: 'Interrupted' },
]

export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.find((entry) => entry.value === params.get('filter'))?.value ?? 'all'
  const setFilter = (value: HistoryFilter) =>
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === 'all') next.delete('filter')
      else next.set('filter', value)
      return next
    })
  return (
    <div className="journey-page studio-history">
      <PageIntro
        eyebrow="History / Your practice record"
        title="History"
        displayTitle={
          <>
            Every attempt.
            <br />
            Its evidence intact.
          </>
        }
        description="Reopen your interviews, follow their evidence, and see what changed. Your questions and answers stay together."
        action={
          <Link to="/prepare" className="journey-secondary">
            New interview <JourneyIcon name="arrow" className="size-4" />
          </Link>
        }
      />
      <div className="history-actions">
        <JourneyLink
          to="/review"
          title="Compare attempts"
          description="Look at the reasoning across different answers."
          icon="history"
        />
        <JourneyLink
          to="/trends"
          title="View trends"
          description="Inspect changes over time, with each lane kept separate."
          icon="improve"
        />
      </div>
      <section className="history-records">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Saved interviews</h2>
          <div className="journey-segment" aria-label="Filter interviews">
            {FILTERS.map((entry) => (
              <button
                type="button"
                key={entry.value}
                aria-pressed={filter === entry.value}
                onClick={() => setFilter(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <SessionHistory filter={filter} />
      </section>
    </div>
  )
}
