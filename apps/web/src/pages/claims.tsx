import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client.ts'
import type { Claim } from '../api/types.ts'
import { Button, Empty, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { useClaimSet } from '../lib/claim-set.ts'
import { words } from '../lib/format.ts'

const PLACEHOLDER = [
  'Paste your résumé as plain text, for example:',
  '',
  'Built a durable job queue on PostgreSQL processing ~10k jobs/day with lease-based worker recovery.',
  'Reduced page load time by 40% by code-splitting the dashboard.',
].join('\n')

export const CROSS_QUESTION = '/session?rounds=project_deep_dive,design_extension'

export function ResumeClaims() {
  const claimSet = useClaimSet()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [clicked, setClicked] = useState<ReadonlyMap<string, boolean>>(new Map())

  const extract = useMutation({
    mutationFn: (text: string) => api.extractClaims(text),
    onSuccess: () => {
      setDraft(null)
      void queryClient.invalidateQueries()
    },
  })

  // Optimistic, and rolled back on failure. The box has to answer the click it was given; what it
  // must never do is stay checked when the server did not agree.
  const confirm = useMutation({
    mutationFn: ({ claim, next }: { claim: Claim; next: boolean }) =>
      api.confirmClaim(claim.id, next),
    onError: (_error, { claim }) =>
      setClicked((current) => {
        const next = new Map(current)
        next.delete(claim.id)
        return next
      }),
    onSettled: () => void queryClient.invalidateQueries(),
  })
  const toggle = (claim: Claim, next: boolean) => {
    setClicked((current) => new Map(current).set(claim.id, next))
    confirm.mutate({ claim, next })
  }

  if (claimSet.isLoading) return <Loading what="your claim set" />
  if (claimSet.isError) return <Failed error={claimSet.error} />
  const set = claimSet.data
  if (set === undefined) return null

  const text = draft ?? set.resumeText ?? ''
  const unchanged = set.resumeText !== null && text === set.resumeText
  const spanOf = (claim: Claim) => set.spans.find((span) => span.id === claim.spanId)
  const isConfirmed = (claim: Claim) => clicked.get(claim.id) ?? set.confirmed.has(claim.id)
  const anyConfirmed = set.claims.some(isConfirmed)
  const rejected = extract.data?.rejected ?? []

  return (
    <div className="space-y-4">
      <Panel
        icon="1"
        title="Your résumé"
        subtitle="Levelhead pulls out what an interviewer would pick at, each tied to the exact words it came from. Nothing is assumed: a claim you do not confirm is never asked about."
      >
        <textarea
          aria-label="Your résumé"
          value={text}
          onChange={(event) => setDraft(event.target.value)}
          rows={7}
          placeholder={PLACEHOLDER}
          className="ring-focus w-full rounded-xl border border-edge bg-ink-2 p-3.5 text-sm leading-relaxed text-body outline-none placeholder:text-quiet/60 focus:border-accent/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            tone="primary"
            onClick={() => extract.mutate(text)}
            disabled={extract.isPending || text.trim() === '' || unchanged}
          >
            {extract.isPending ? 'reading your résumé…' : 'Extract claims'}
          </Button>
          <Quiet>
            {unchanged
              ? 'Already read. Edit the text to read it again.'
              : 'Treated as untrusted text: it is read, never obeyed.'}
          </Quiet>
        </div>
        {extract.isError && (
          <div className="mt-3">
            <Failed error={extract.error} />
          </div>
        )}
        {rejected.length > 0 && (
          <div className="mt-3 rounded-xl border border-shaky/40 bg-shaky/5 p-3">
            <p className="text-xs text-shaky">
              Refused rather than adjusted: a quote that is not in your text word for word would be
              a made-up citation.
            </p>
            <ul className="mt-1 space-y-1 text-xs text-quiet">
              {rejected.map((entry, index) => (
                <li key={index}>
                  {entry.reason}: {entry.quote}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel
        icon="2"
        title="What an interviewer will pick from your résumé"
        subtitle="Confirm the ones you can explain in depth. Only confirmed claims are cross-questioned."
        actions={
          anyConfirmed ? (
            <Link
              to={CROSS_QUESTION}
              className="ring-focus inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-accent to-[#6f5cf0] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(139,123,255,0.7)] transition hover:brightness-110"
            >
              Cross-question my résumé <span aria-hidden>→</span>
            </Link>
          ) : undefined
        }
      >
        {set.claims.length === 0 ? (
          <Empty>
            Nothing extracted yet. Paste your résumé above and press Extract claims; each line an
            interviewer could ask about shows up here for you to confirm.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {set.claims.map((claim) => {
              const span = spanOf(claim)
              return (
                <li
                  key={claim.id}
                  className={`rounded-xl border p-3.5 transition ${
                    isConfirmed(claim)
                      ? 'border-accent/40 bg-accent/[0.06]'
                      : 'border-edge bg-white/[0.02]'
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isConfirmed(claim)}
                      onChange={(event) => toggle(claim, event.currentTarget.checked)}
                      className="mt-1 size-4 accent-[#8b7bff]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-[15px] text-body">{claim.assertion}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        <Tag tone="accent">{words(claim.type)}</Tag>
                        {claim.implied && <Tag tone="shaky">implied, not stated</Tag>}
                        {claim.technologies.map((technology) => (
                          <Tag key={technology}>{technology}</Tag>
                        ))}
                        {claim.metrics.map((metric) => (
                          <Tag key={metric}>{metric}</Tag>
                        ))}
                      </span>
                      {span !== undefined && (
                        <span className="mt-2 block text-xs text-quiet">
                          span {span.startByte}–{span.endByte} ·{' '}
                          <span className="text-muted">&ldquo;{span.quoted}&rdquo;</span>
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        {set.claims.length > 0 && !anyConfirmed && (
          <p className="mt-3 text-[13px] text-quiet">
            Confirm at least one claim to be cross-questioned on it.
          </p>
        )}
        {confirm.isError && (
          <div className="mt-3">
            <Failed error={confirm.error} />
          </div>
        )}
      </Panel>
    </div>
  )
}
