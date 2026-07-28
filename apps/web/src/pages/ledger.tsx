import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import type { GapEntry } from '../api/types.ts'
import { Empty, Failed, Loading, Panel, Tag } from '../components/primitives.tsx'
import { day, words } from '../lib/format.ts'

const TONE: Record<GapEntry['status'], 'held' | 'shaky' | 'broken' | 'quiet'> = {
  closed_under_transfer: 'held',
  drilled: 'shaky',
  open: 'broken',
  unverified: 'quiet',
}

const MEANING: Record<GapEntry['status'], string> = {
  closed_under_transfer: 'held under transfer, in a later session',
  drilled: 'the drill landed — transfer still pending, and a drill closes nothing',
  open: 'still open',
  unverified: 'never successfully judged — the evaluator abstained',
}

export function LedgerPage() {
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: api.ledger })

  if (ledger.isLoading) return <Loading what="the gap ledger" />
  if (ledger.isError) return <Failed error={ledger.error} />
  const data = ledger.data
  if (data === undefined) return null

  return (
    <div className="space-y-4">
      <Panel
        title="Gap ledger"
        subtitle="This is what replaces a readiness score. There is no number here, and there will not be one."
      >
        {data.gaps.length === 0 ? (
          <Empty>No gaps yet — run a session.</Empty>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-quiet">
                <th className="py-2 pr-3">Gap</th>
                <th className="py-2 pr-3">Competency</th>
                <th className="py-2 pr-3">Evidence</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.gaps.map((gap) => (
                <tr key={gap.id} className="border-b border-edge/60 align-top">
                  <td className="py-2 pr-3">{gap.summary}</td>
                  <td className="py-2 pr-3 text-quiet">{words(gap.competency)}</td>
                  <td className="py-2 pr-3 text-quiet">
                    {gap.evidenceIds
                      .map((id) => data.quotes.find((quote) => quote.evidenceId === id)?.quoted)
                      .filter((quoted): quoted is string => quoted !== undefined)
                      .map((quoted, index) => (
                        <span key={index} className="block border-l-2 border-edge pl-2 text-held">
                          {quoted}
                        </span>
                      ))}
                    <span className="block text-[11px]">opened {day(gap.openedAt)}</span>
                  </td>
                  <td className="py-2">
                    <Tag tone={TONE[gap.status]}>{words(gap.status)}</Tag>
                    <span className="mt-1 block text-[11px] text-quiet">{MEANING[gap.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Citations">
        <p className="text-sm">
          {data.unresolvedCitations === 0
            ? 'Every citation in every session resolves byte-for-byte against the text it quotes.'
            : `${data.unresolvedCitations} citations do not resolve. That is a defect in CLOSER, not a judgment about you.`}
        </p>
      </Panel>
    </div>
  )
}
