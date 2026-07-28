import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { EvidenceProvider, Highlighted, useEvidence } from '../components/evidence.tsx'
import { FindingCard } from '../components/finding-card.tsx'
import { Button, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { usd, words } from '../lib/format.ts'

function ReplayBody({ sessionId }: { sessionId: string }) {
  const evidence = useEvidence()
  const replay = useQuery({ queryKey: ['replay', sessionId], queryFn: () => api.replay(sessionId) })
  const view = useQuery({ queryKey: ['session', sessionId], queryFn: () => api.session(sessionId) })
  const events = useQuery({ queryKey: ['events', sessionId], queryFn: () => api.events(sessionId) })

  if (replay.isLoading || view.isLoading) return <Loading what="the session" />
  if (replay.isError) return <Failed error={replay.error} />
  if (view.isError) return <Failed error={view.error} />
  const replayed = replay.data
  const session = view.data
  if (replayed === undefined || session === undefined) return null

  return (
    <div className="space-y-4">
      <Panel
        title="Replayed from the log"
        subtitle="Nothing here is recomputed by a model. The events are folded again and every citation is re-checked byte-for-byte."
      >
        <div className="flex flex-wrap gap-2">
          <Tag tone="held">{replayed.events} events</Tag>
          <Tag tone="held">{replayed.spansChecked} citations re-checked</Tag>
          <Tag>{session.invocations.length} model calls</Tag>
          <Tag>{usd(session.totals.costUsd)}</Tag>
          <Tag>{session.totals.tokens} tokens</Tag>
          {session.closed !== null && <Tag>stopped by {words(session.closed.reason)}</Tag>}
        </div>
      </Panel>

      <Panel title="Transcript" subtitle="Hover a finding below to see the words it cites.">
        <ol className="space-y-2">
          {replayed.transcript.map((entry, index) => (
            <li key={index}>
              <span className="text-[11px] uppercase tracking-wide text-quiet">{entry.role}</span>
              <p className="whitespace-pre-wrap text-sm">
                <Highlighted text={entry.text} quotes={evidence.active} />
              </p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Findings">
        <div className="space-y-2">
          {replayed.findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} quotes={replayed.quotes} />
          ))}
        </div>
      </Panel>

      <Panel
        title="Why each question was asked"
        subtitle="Every plan the policy considered, and the action code chose. The model only phrased it."
      >
        <ol className="space-y-1 text-xs">
          {(events.data ?? [])
            .filter((event) => event.kind === 'plan')
            .map((event, index) => {
              const payload = event.payload as {
                chosen: string
                pressureLevel: number
                considered: { action: string; score: number; reason: string }[]
              }
              return (
                <li key={index} className="rounded border border-edge bg-[#111720] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="accent">{words(payload.chosen.toLowerCase())}</Tag>
                    <Tag>pressure {payload.pressureLevel}</Tag>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-quiet">
                    {payload.considered
                      .slice()
                      .sort((left, right) => right.score - left.score)
                      .map((option, at) => (
                        <li key={at}>
                          {option.score.toFixed(2)} · {words(option.action.toLowerCase())} —{' '}
                          {option.reason}
                        </li>
                      ))}
                  </ul>
                </li>
              )
            })}
        </ol>
      </Panel>
    </div>
  )
}

export function ReplayPage() {
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState(params.get('id') ?? '')
  const sessionId = params.get('id')

  return (
    <EvidenceProvider>
      <div className="space-y-4">
        <Panel
          title="Replay a session"
          subtitle="A session id — the URL is the state, so this view is linkable."
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="ses_…"
              className="rounded border border-edge bg-[#0f141b] px-2 py-1 text-sm"
            />
            <Button tone="primary" onClick={() => setParams({ id: draft })}>
              Replay
            </Button>
            <Quiet>Replay is exact: same events in, same view out.</Quiet>
          </div>
        </Panel>
        {sessionId !== null && sessionId !== '' && <ReplayBody sessionId={sessionId} />}
      </div>
    </EvidenceProvider>
  )
}
