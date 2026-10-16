import { useQuery } from '@tanstack/react-query'
import { api, type Analytics } from '../api/client.ts'
import { Lane } from '../components/lane.tsx'
import { Sparkline } from '../components/sparkline.tsx'
import { Empty, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { day, words } from '../lib/format.ts'

type Trend = Analytics['performance'][number]
type Snapshot = Analytics['ledger'][number]
type Composure = Analytics['composure'][number]

function TrendRow({ trend }: { trend: Trend }) {
  const values = trend.points.map((point) => point.value)
  const first = values[0]
  const last = values[values.length - 1]
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/60 py-2">
      <div>
        <p className="text-sm">{words(trend.signal)}</p>
        <p className="text-[11px] text-quiet">
          {trend.points.length} session{trend.points.length === 1 ? '' : 's'}
          {first !== undefined && last !== undefined
            ? ` · ${first.toFixed(2)} → ${last.toFixed(2)}`
            : ''}
        </p>
      </div>
      <Sparkline values={values} />
    </div>
  )
}

function ComposureRow({ row }: { row: Composure }) {
  const total = row.held + row.folded
  const pct = (part: number) => (total === 0 ? 0 : Math.round((part / total) * 100))
  return (
    <div className="border-b border-edge/60 py-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">pressure {row.level}</span>
        <span className="flex gap-2">
          <Tag tone="held">held {row.held}</Tag>
          <Tag tone="broken">folded {row.folded}</Tag>
        </span>
      </div>
      {/* Two bars, never one ratio: composure held and composure folded are counted separately. */}
      <div className="mt-1 flex h-2 w-full gap-0.5">
        <span className="h-2 rounded-sm bg-held/60" style={{ width: `${pct(row.held)}%` }} />
        <span className="h-2 rounded-sm bg-broken/60" style={{ width: `${pct(row.folded)}%` }} />
      </div>
    </div>
  )
}

export function TrendsPage() {
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: api.analytics })

  if (analytics.isLoading) return <Loading what="your trends" />
  if (analytics.isError) return <Failed error={analytics.error} />
  const data = analytics.data
  if (data === undefined) return null

  const sessionCount = data.ledger.length
  const gapsOpen = data.ledger.map((snapshot: Snapshot) => snapshot.gapsOpen)

  return (
    <div className="space-y-4">
      <Panel
        title="Trends"
        subtitle="Everything you have done, over time. No aggregate, no readiness number — two kinds of series that never share an axis."
      >
        {sessionCount <= 1 ? (
          <Quiet>
            A trend needs more than one session. You have {sessionCount}. Run another and the same
            signals will start to show movement.
          </Quiet>
        ) : (
          <Quiet>
            {sessionCount} sessions. Each performance signal is its own line; a delivery number and
            a gap count are never drawn on the same axis.
          </Quiet>
        )}
      </Panel>

      <Lane kind="performance">
        <h3 className="mb-2 text-sm text-body">Performance signals over time</h3>
        {data.performance.length === 0 ? (
          <Empty>
            No prosody or kinematics recorded across your sessions yet. Practice an answer aloud in
            the studio to start a series.
          </Empty>
        ) : (
          <div>
            {data.performance.map((trend) => (
              <TrendRow key={trend.signal} trend={trend} />
            ))}
          </div>
        )}
      </Lane>

      <Lane kind="competence">
        <h3 className="mb-2 text-sm text-body">Gap ledger over time</h3>
        {data.ledger.length === 0 ? (
          <Empty>No sessions recorded yet.</Empty>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-quiet">open gaps</span>
              <Sparkline values={gapsOpen} />
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-quiet">
                  <th className="py-2 pr-3">Session</th>
                  <th className="py-2 pr-3">Open</th>
                  <th className="py-2 pr-3">Drilled</th>
                  <th className="py-2 pr-3">Unverified</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Abstentions</th>
                  <th className="py-2">Pressure</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((snapshot) => (
                  <tr key={snapshot.sessionId} className="border-b border-edge/60">
                    <td className="py-2 pr-3 text-quiet">{day(snapshot.at)}</td>
                    <td className="py-2 pr-3">{snapshot.gapsOpen}</td>
                    <td className="py-2 pr-3">{snapshot.gapsDrilled}</td>
                    <td className="py-2 pr-3">{snapshot.gapsUnverified}</td>
                    <td className="py-2 pr-3">{snapshot.gapsClosedUnderTransfer}</td>
                    <td className="py-2 pr-3">{snapshot.abstentions}</td>
                    <td className="py-2">{snapshot.pressureReached}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mt-4 mb-2 text-sm text-body">Composure by pressure</h3>
        {data.composure.length === 0 ? (
          <Empty>No composure findings across your sessions yet.</Empty>
        ) : (
          <div>
            {data.composure.map((row) => (
              <ComposureRow key={row.level} row={row} />
            ))}
          </div>
        )}
      </Lane>
    </div>
  )
}
