import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import { Empty, Failed, Loading, Panel, Tag } from '../components/primitives.tsx'
import { ClaimChip, TopicChip } from '../components/question.tsx'
import { ROUND_LABEL, useTopicById } from '../lib/catalog.ts'
import { useClaimSet } from '../lib/claim-set.ts'
import { day, words } from '../lib/format.ts'

const REASON: Record<string, string> = {
  drill_the_open_gap: 'open — needs a drill',
  transfer_the_drilled_gap: 'drilled — needs a transfer test under changed constraints',
  retrieve_the_closed_gap: 'closed — due for unannounced retrieval',
  restate_the_unverified: 'never judged — ask for it explicitly',
}

export function SchedulePage() {
  const [horizon, setHorizon] = useState(7)
  const cache = useQueryClient()
  const save = useMutation({
    mutationFn: api.saveSchedule,
    onSuccess: () => cache.invalidateQueries({ queryKey: ['schedule'] }),
  })
  const plan = useQuery({
    queryKey: ['schedule', horizon],
    queryFn: () => api.schedule(horizon),
  })
  const topicById = useTopicById()
  const claimSet = useClaimSet()
  const minutes = plan.data?.availableMinutes ?? null
  const budgetTurns = (rounds: number) =>
    minutes === null ? null : Math.min(20, Math.floor(minutes / (5 * rounds)))
  const oneTurnFits = budgetTurns(1) === null || budgetTurns(1)! >= 1
  const coverageTurns = budgetTurns(1)
  const roundTurns = budgetTurns(Math.max(1, plan.data?.suggestedRounds.length ?? 1))

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
        {plan.data?.availableMinutes != null && (
          <p className="mb-3 text-xs text-quiet">
            Your saved time: {plan.data.availableMinutes} minutes. Planning assumes five minutes per
            question; this is an unmeasured estimate, not a timer. You can change the setup.
          </p>
        )}
        {plan.data !== undefined &&
          plan.data.retrievals.length > 0 &&
          roundTurns !== null &&
          roundTurns < 3 && (
            <p className="mb-3 text-xs text-quiet">
              The estimated budget is shorter than the three turns currently needed to interleave
              recall. It may not be asked in this session.
            </p>
          )}
        {plan.isLoading && <Loading what="the schedule" />}
        {plan.isError && <Failed error={plan.error} />}
        {save.isError && <Failed error={save.error} />}
        {plan.data?.saved !== null && plan.data?.saved !== undefined && (
          <p className="mb-3 text-xs text-quiet">
            Saved choice: {plan.data.saved.mode} · {plan.data.saved.gapId}.
            {plan.data.work.some(
              (entry) =>
                entry.gap.id === plan.data!.saved!.gapId && entry.action === plan.data!.saved!.mode,
            )
              ? ' Ready below.'
              : ' This choice is no longer available; choose another.'}
          </p>
        )}
        {plan.data !== undefined && plan.data.work.length === 0 && (
          <Empty>Nothing is due in this horizon.</Empty>
        )}
        {plan.data !== undefined && plan.data.work.length > 0 && (
          <ul className="space-y-2">
            {plan.data.work.map((entry) => {
              const topic = topicById(entry.gap.topicId)
              const claim = claimSet.data?.claims.find((known) => known.id === entry.gap.claimId)
              return (
                <li key={entry.gap.id} className="rounded-md border border-edge bg-[#111720] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {topic !== undefined && <TopicChip topic={topic} />}
                    {claim !== undefined && <ClaimChip assertion={claim.assertion} />}
                    <Tag tone="accent">{words(entry.gap.competency)}</Tag>
                    <Tag>{REASON[entry.reason] ?? entry.reason}</Tag>
                    <Tag>due {day(entry.dueAt)}</Tag>
                  </div>
                  <p className="mt-1 text-sm">{entry.gap.summary}</p>
                  {entry.action !== 'unavailable' && (
                    <>
                      {oneTurnFits && (
                        <Link
                          className="mt-2 inline-block text-xs text-accent-soft underline"
                          to={`/session?mode=${entry.action}&gapId=${encodeURIComponent(entry.gap.id)}`}
                        >
                          {entry.action === 'drill'
                            ? 'Practise this gap'
                            : 'Try an unfamiliar variant'}
                        </Link>
                      )}
                      {!oneTurnFits && (
                        <span className="mt-2 inline-block text-xs text-quiet">
                          A question exceeds the five-minute planning estimate.
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={save.isPending}
                        className="ml-4 text-xs text-accent-soft underline"
                        onClick={() => {
                          if (entry.action !== 'unavailable')
                            save.mutate({ gapId: entry.gap.id, mode: entry.action })
                        }}
                      >
                        Save this choice
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {plan.data?.coverage !== null && plan.data?.coverage !== undefined && (
        <Panel title="An untested topic">
          <p className="text-sm">
            {plan.data.coverage.title} has not appeared in your recorded attempts. This does not
            imply mastery or weakness.
          </p>
          {(coverageTurns === null || coverageTurns > 0) && (
            <Link
              className="mt-2 inline-block text-xs text-accent-soft underline"
              to={`/session?rounds=${plan.data.coverage.round}&topicId=${encodeURIComponent(plan.data.coverage.id)}&role=${encodeURIComponent(plan.data.coverage.roleId)}&level=${plan.data.coverage.level}${coverageTurns === null ? '' : `&turns=${coverageTurns}`}`}
            >
              Practise this topic
            </Link>
          )}
          {coverageTurns === 0 && (
            <p className="mt-2 text-xs text-quiet">
              The saved time is shorter than the five-minute question estimate.
            </p>
          )}
        </Panel>
      )}

      {plan.data !== undefined && plan.data.suggestedRounds.length > 0 && (
        <Panel title="Rounds that would cover it">
          <div className="flex flex-wrap items-center gap-2">
            {plan.data.suggestedRounds.map((round) => (
              <Tag key={round} tone="accent">
                {ROUND_LABEL[round]}
              </Tag>
            ))}
            {(roundTurns === null || roundTurns > 0) && (
              <Link
                to={`/session?rounds=${plan.data.suggestedRounds.join(',')}${roundTurns === null ? '' : `&turns=${roundTurns}`}`}
                className="ml-2 text-[13px] text-accent-soft underline underline-offset-2"
              >
                Practise these rounds
              </Link>
            )}
            {roundTurns === 0 && (
              <span className="text-xs text-quiet">
                The saved time is too short for one estimated question in every round.
              </span>
            )}
          </div>
        </Panel>
      )}
    </div>
  )
}
