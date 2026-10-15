import type { ReactNode } from 'react'

// The one line the performance lane must always carry: a delivery number is never a verdict. It is
// its own component so every surface that shows a performance number shows this beside it.
export function PerformanceDisclaimer() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-shaky/30 bg-shaky/[0.07] px-4 py-3 text-[12px] leading-relaxed text-shaky">
      <span aria-hidden className="mt-px">
        ⚠
      </span>
      <span>
        These numbers describe how you spoke and moved. They say nothing about whether an answer was
        any good, and none of them can enter a finding, a rubric, or the gap ledger.
      </span>
    </p>
  )
}

// The visible wall. The two lanes never share a card, a row, or a colour: competence is anchored in
// the accent, performance in the warning tone, and the performance lane always opens with the
// disclaimer above. A reader cannot mistake one for the other.
export function Lane({
  kind,
  children,
}: {
  kind: 'competence' | 'performance'
  children: ReactNode
}) {
  const competence = kind === 'competence'
  return (
    <section className={`lane-report rise ${competence ? 'competence' : 'performance'}`}>
      <header className="mb-4 flex items-start gap-3">
        <div>
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
              competence ? 'text-accent-soft' : 'text-shaky'
            }`}
          >
            {competence ? 'Competence lane · judged' : 'Performance lane · observed, never judged'}
          </span>
          <h2 className="text-[17px] font-semibold tracking-tight text-body">
            {competence ? 'What the answer was judged to be' : 'How the answer was delivered'}
          </h2>
          <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-quiet">
            {competence
              ? 'Findings with the evidence they cite, a stated confidence, or an honest abstention — plus the gaps this session touched.'
              : 'Speech, rhythm and body numbers, each shown with the baseline or the within-session contrast it is measured against.'}
          </p>
        </div>
      </header>
      {!competence && (
        <div className="mb-4">
          <PerformanceDisclaimer />
        </div>
      )}
      <div className="lane-content">{children}</div>
    </section>
  )
}
