import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import type { Claim, ClaimsResponse } from '../api/types.ts'
import { Button, Failed, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { Highlighted } from '../components/evidence.tsx'

const SAMPLE =
  'Built a durable job queue on PostgreSQL processing ~10k jobs/day with lease-based worker recovery.'

export function ClaimsPage() {
  const [resume, setResume] = useState(SAMPLE)
  const [extracted, setExtracted] = useState<ClaimsResponse | null>(null)
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const extract = useMutation({
    mutationFn: () => api.extractClaims(resume),
    onSuccess: (data) => {
      setExtracted(data)
      setConfirmed(new Set())
    },
  })

  const toggle = (claimId: string, next: boolean) => {
    setConfirmed((current) => {
      const updated = new Set(current)
      if (next) updated.add(claimId)
      else updated.delete(claimId)
      return updated
    })
  }

  // Optimistic, and rolled back on failure. The box has to answer the click it was given; what it
  // must never do is stay checked when the server did not agree.
  const confirm = useMutation({
    mutationFn: ({ claim, next }: { claim: Claim; next: boolean }) =>
      api.confirmClaim(claim.id, next),
    onMutate: (variables) => toggle(variables.claim.id, variables.next),
    onError: (_error, variables) => toggle(variables.claim.id, !variables.next),
    onSuccess: () => void queryClient.invalidateQueries(),
  })

  const spanOf = (claim: Claim) => extracted?.spans.find((span) => span.id === claim.spanId)

  return (
    <div className="space-y-4">
      <Panel
        title="Your résumé"
        subtitle="Nothing is assumed. You own the claim set — a claim you do not confirm is never interrogated."
      >
        <textarea
          value={resume}
          onChange={(event) => setResume(event.target.value)}
          rows={6}
          className="w-full rounded-md border border-edge bg-[#0f141b] p-3 text-sm outline-none focus:border-accent/50"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button tone="primary" onClick={() => extract.mutate()} disabled={extract.isPending}>
            {extract.isPending ? 'extracting…' : 'Extract claims'}
          </Button>
          {extracted !== null && (
            <Quiet>
              {extracted.claims.length} claims · {extracted.rejected.length} rejected because the
              quote was not in your text verbatim
            </Quiet>
          )}
        </div>
        {extract.isError && (
          <div className="mt-3">
            <Failed error={extract.error} />
          </div>
        )}
      </Panel>

      {extracted !== null && (
        <Panel
          title="Where each claim came from"
          subtitle="Byte-exact spans, highlighted in your own text."
        >
          <p className="whitespace-pre-wrap rounded-md border border-edge bg-[#0f141b] p-3 text-sm">
            <Highlighted
              text={resume}
              quotes={
                hovered === null
                  ? []
                  : [extracted.spans.find((span) => span.id === hovered)?.quoted ?? '']
              }
            />
          </p>
        </Panel>
      )}

      {extracted !== null && (
        <Panel title="Claims" subtitle="Confirm the ones you are willing to defend.">
          <ul className="space-y-2">
            {extracted.claims.map((claim) => (
              <li
                key={claim.id}
                onMouseEnter={() => setHovered(claim.spanId)}
                onMouseLeave={() => setHovered(null)}
                className="rounded-md border border-edge bg-[#111720] p-3"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={confirmed.has(claim.id)}
                    onChange={(event) =>
                      confirm.mutate({ claim, next: event.currentTarget.checked })
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="text-sm">{claim.assertion}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Tag tone="accent">{claim.type}</Tag>
                      {claim.implied && <Tag tone="shaky">implied, not stated</Tag>}
                      {claim.technologies.map((technology) => (
                        <Tag key={technology}>{technology}</Tag>
                      ))}
                      {claim.metrics.map((metric) => (
                        <Tag key={metric}>{metric}</Tag>
                      ))}
                    </span>
                    <span className="mt-1 block text-xs text-quiet">
                      span {spanOf(claim)?.startByte}–{spanOf(claim)?.endByte} ·{' '}
                      {spanOf(claim)?.quoted}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {extracted.rejected.length > 0 && (
            <div className="mt-3 rounded-md border border-shaky/40 bg-shaky/5 p-3">
              <p className="text-xs text-shaky">
                Refused rather than adjusted — a quote that is not in your text verbatim would be a
                fabricated citation.
              </p>
              <ul className="mt-1 space-y-1 text-xs text-quiet">
                {extracted.rejected.map((rejected, index) => (
                  <li key={index}>
                    {rejected.reason}: {rejected.quote}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
