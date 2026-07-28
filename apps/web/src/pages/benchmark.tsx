import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { Empty, Failed, Loading, Panel, Tag } from '../components/primitives.tsx'

const TONE = { pass: 'held', fail: 'broken', unknown: 'quiet' } as const

export function BenchmarkPage() {
  const runs = useQuery({ queryKey: ['benchmark'], queryFn: api.benchmarkRuns })

  return (
    <div className="space-y-4">
      <Panel
        title="Benchmark"
        subtitle="Every run publishes in full, with no editorial step. A failing gate stays on this page."
      >
        {runs.isLoading && <Loading what="published runs" />}
        {runs.isError && <Failed error={runs.error} />}
        {runs.data !== undefined && runs.data.runs.length === 0 && (
          <Empty>
            No benchmark has been run against a real provider. Nothing here may be reported as a
            result until one has, and no number will be invented in the meantime.
          </Empty>
        )}
      </Panel>

      {runs.data?.runs.map((run) => (
        <Panel key={run.runId} title={run.runId} subtitle={run.startedAt}>
          <div className="flex flex-wrap gap-2">
            {run.syntheticFixtureData && <Tag tone="shaky">synthetic fixture data</Tag>}
            <Tag tone={run.claimsPermitted ? 'held' : 'broken'}>
              {run.claimsPermitted ? 'claims permitted' : 'claims not permitted'}
            </Tag>
            {run.arms.map((arm) => (
              <Tag key={arm}>{arm}</Tag>
            ))}
          </div>
          <p className="mt-2 text-xs text-quiet">{run.claimsPermittedReason}</p>
          <ul className="mt-2 space-y-1">
            {run.gates.map((gate) => (
              <li key={gate.id} className="rounded border border-edge bg-[#111720] p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={TONE[gate.status as keyof typeof TONE] ?? 'quiet'}>{gate.status}</Tag>
                  <span>{gate.id}</span>
                  <span className="text-quiet">{gate.threshold}</span>
                  {gate.observed !== null && (
                    <span className="text-quiet">observed {gate.observed}</span>
                  )}
                </div>
                <p className="mt-1 text-quiet">{gate.reason}</p>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1 text-xs text-quiet">
            {run.stopConditions.map((stop) => (
              <li key={stop.id}>
                stop condition {stop.id}: {stop.status}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  )
}
