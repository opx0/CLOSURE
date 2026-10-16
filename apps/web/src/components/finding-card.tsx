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
  if (finding.kind === 'competency_abstained') {
    return {
      text: `${words(finding.competency)} — abstained, ${words(finding.abstention)}`,
      tone: 'quiet',
    }
  }
  if (finding.kind === 'composure') {
    return { text: `composure — ${finding.signals.map(words).join(', ')}`, tone: 'held' }
  }
  return finding.levelMet === null
    ? { text: `${words(finding.competency)} — short of the ${finding.level} anchor`, tone: 'shaky' }
    : { text: `${words(finding.competency)} — meets the ${finding.levelMet} anchor`, tone: 'held' }
}

export function abstained(finding: Finding): boolean {
  return finding.kind === 'claim_abstained' || finding.kind === 'competency_abstained'
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
  const focusCitations = () => {
    if (
      evidence.active.length !== cited.length ||
      cited.some((quote, index) => evidence.active[index] !== quote)
    ) {
      evidence.focus(cited)
    }
  }

  return (
    <article
      onMouseEnter={focusCitations}
      // A reply can insert this card beneath a stationary pointer. Movement within it must also
      // activate citations; relying only on the boundary-crossing event misses that layout change.
      onMouseMove={focusCitations}
      onMouseLeave={evidence.clear}
      onFocus={focusCitations}
      onBlur={evidence.clear}
      tabIndex={0}
      className="finding-record outline-none transition"
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
      <p className="mt-2.5 text-sm leading-relaxed text-body">{finding.rationale}</p>
      {abstained(finding) && (
        <p className="mt-1.5 text-[12px] text-quiet">
          The evaluator could not tell from this answer, so it says so rather than guess.
        </p>
      )}
      {cited.length === 0 ? (
        <p className="mt-2 text-xs text-broken">
          this finding cites nothing that resolved — that is a defect, not a judgment
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-quiet/80">
            your words
          </p>
          <ul className="mt-1 space-y-1">
            {cited.map((quoted, index) => (
              <li
                key={`${quoted}-${index}`}
                className="border-l-2 border-held/50 pl-3 text-sm text-held"
              >
                {quoted}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[11px] text-quiet">
        {finding.modelVersion} · prompt {finding.promptVersion}
      </p>
    </article>
  )
}
