import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { Empty, Failed, Loading, Panel, Tag } from '../components/primitives.tsx'
import { day, words } from '../lib/format.ts'

const REASON: Record<string, string> = {
  drill_the_open_gap: 'open — needs a drill',
  transfer_the_drilled_gap: 'drilled — needs a transfer test under changed constraints',
  retrieve_the_closed_gap: 'closed — due for unannounced retrieval',
  restate_the_unverified: 'never judged — ask for it explicitly',
}

export function SchedulePage() {
  const [horizon, setHorizon] = useState(7)
  const plan = useQuery({
    queryKey: ['schedule', horizon],
    queryFn: () => api.schedule(horizon),
  })

  return (
    <div className="space-y-4">
      <Panel
        title="What is due"
        subtitle="Spaced retrieval arrives inside an ordinary session, unannounced. This page is for you, not for the interviewer."
        actions={
          <label className="text-xs text-quiet">
            horizon
            <input
              type="number"
              min={1}
              max={90}
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value))}
              className="ml-2 w-16 rounded border border-edge bg-[#0f141b] px-2 py-1"
            />
            days
          </label>
        }
      >
        {plan.isLoading && <Loading what="the schedule" />}
        {plan.isError && <Failed error={plan.error} />}
        {plan.data !== undefined && plan.data.work.length === 0 && (
          <Empty>Nothing is due in this horizon.</Empty>
        )}
        {plan.data !== undefined && plan.data.work.length > 0 && (
          <ul className="space-y-2">
            {plan.data.work.map((entry) => (
              <li key={entry.gap.id} className="rounded-md border border-edge bg-[#111720] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="accent">{words(entry.gap.competency)}</Tag>
                  <Tag>{REASON[entry.reason] ?? entry.reason}</Tag>
                  <Tag>due {day(entry.dueAt)}</Tag>
                </div>
                <p className="mt-1 text-sm">{entry.gap.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {plan.data !== undefined && (
        <Panel title="Rounds that would cover it">
          <div className="flex flex-wrap gap-2">
            {plan.data.suggestedRounds.map((round) => (
              <Tag key={round} tone="accent">
                {words(round)}
              </Tag>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
