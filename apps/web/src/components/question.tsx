import type { ShownArtifact } from '../api/types.ts'
import { topicLabel, type TopicSummary } from '../lib/catalog.ts'

export function TopicChip({ topic }: { topic: Pick<TopicSummary, 'area' | 'title'> }) {
  return (
    <span className="inline-flex items-center rounded-full border border-cyan/30 bg-cyan/10 px-2.5 py-0.5 text-[12px] font-medium text-cyan">
      {topicLabel(topic)}
    </span>
  )
}

export function ClaimChip({ assertion }: { assertion: string }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[12px] font-medium text-accent-soft">
      <span className="truncate">Résumé · “{assertion}”</span>
    </span>
  )
}

export function FilePanel({ artifact }: { artifact: ShownArtifact }) {
  const lines = artifact.code.replace(/\n$/, '').split('\n')
  const first = artifact.startLine ?? 1
  const last = artifact.endLine ?? first + lines.length - 1
  const range =
    artifact.startLine === undefined ? `${lines.length} lines` : `lines ${first}–${last}`

  return (
    <figure className="overflow-hidden rounded-xl border border-edge bg-ink-2">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge bg-white/[0.02] px-4 py-2.5">
        <span aria-hidden className="text-quiet">
          ▤
        </span>
        <span className="mono text-[13px] font-medium text-body">{artifact.path}</span>
        {artifact.symbol !== undefined && (
          <span className="mono rounded-md border border-accent/30 bg-accent/10 px-1.5 text-[12px] text-accent-soft">
            {artifact.symbol}
          </span>
        )}
        <span className="text-[12px] text-quiet">{range}</span>
      </figcaption>
      <pre className="mono max-h-[26rem] overflow-auto py-3 text-[12.5px] leading-[1.7] [font-variant-ligatures:none]">
        <code className="block min-w-max">
          {lines.map((line, index) => (
            <span key={index} className="flex hover:bg-white/[0.03]">
              <span aria-hidden className="w-14 shrink-0 select-none pr-4 text-right text-quiet/50">
                {first + index}
              </span>
              <span className="whitespace-pre pr-6 text-muted">{line === '' ? ' ' : line}</span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  )
}
