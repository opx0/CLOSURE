import type { Finding, QuotedEvidence } from '../api/types.ts'
import { confidenceWord, words } from '../lib/format.ts'
import { useEvidence } from './evidence.tsx'
import { Tag } from './primitives.tsx'

export function headlineOf(finding: Finding): {
  text: string
  tone: 'held' | 'shaky' | 'broken' | 'quiet'
} {
  if (finding.kind === 'claim') {
    const tone =
      finding.verdict === 'supported'
        ? 'held'
        : finding.verdict === 'partially_supported'
          ? 'shaky'
          : 'broken'
    return { text: `claim ${words(finding.verdict)}`, tone }
  }
  if (finding.kind === 'claim_abstained') {
    return { text: `abstained — ${words(finding.abstention)}`, tone: 'quiet' }
  }
  if (finding.kind === 'composure') {
    return { text: `composure — ${finding.signals.map(words).join(', ')}`, tone: 'held' }
  }
  return {
    text: `${words(finding.competency)} — met ${finding.levelMet ?? 'no level anchor'}`,
    tone: finding.levelMet === null ? 'shaky' : 'held',
  }
}

// No aggregate anywhere on this card, by construction: there is no field to put one in, and the
// evidence is the point of the component.
export function FindingCard({
  finding,
  quotes,
}: {
  finding: Finding
  quotes: readonly QuotedEvidence[]
}) {
  const evidence = useEvidence()
  const cited = finding.evidenceIds
    .map((id) => quotes.find((quote) => quote.evidenceId === id)?.quoted)
    .filter((quoted): quoted is string => quoted !== undefined)
  const headline = headlineOf(finding)

  return (
    <article
      onMouseEnter={() => evidence.focus(cited)}
      onMouseLeave={evidence.clear}
      onFocus={() => evidence.focus(cited)}
      onBlur={evidence.clear}
      tabIndex={0}
      className="rounded-md border border-edge bg-[#111720] p-3 outline-none transition focus:border-accent/50 hover:border-accent/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={headline.tone}>{headline.text}</Tag>
        <Tag>
          confidence {confidenceWord(finding.confidence)} · {finding.confidence.toFixed(2)}
        </Tag>
        <Tag>judged at {finding.level}</Tag>
        <Tag>
          rubric {finding.rubric.id} v{finding.rubric.version}
        </Tag>
      </div>
      <p className="mt-2 text-sm">{finding.rationale}</p>
      {cited.length === 0 ? (
        <p className="mt-2 text-xs text-broken">
          this finding cites nothing that resolved — that is a defect, not a judgment
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {cited.map((quoted, index) => (
            <li
              key={`${quoted}-${index}`}
              className="border-l-2 border-held/50 pl-3 text-sm text-held"
            >
              {quoted}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-quiet">
        {finding.modelVersion} · prompt {finding.promptVersion}
      </p>
    </article>
  )
}
