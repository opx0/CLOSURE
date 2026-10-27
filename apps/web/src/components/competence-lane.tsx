import { Link } from 'react-router-dom'
import type { Debrief } from '../api/client.ts'
import { useTopicById } from '../lib/catalog.ts'
import { confidenceWord, day, words } from '../lib/format.ts'
import { headlineOf } from './finding-card.tsx'
import { Empty, Tag } from './primitives.tsx'
import { TopicChip } from './question.tsx'

type CompetenceLane = Debrief['competence']
type Finding = CompetenceLane['findings'][number]
type Gap = CompetenceLane['gaps'][number]

const GAP_TONE: Record<Gap['status'], 'held' | 'shaky' | 'broken' | 'quiet'> = {
  closed_under_transfer: 'held',
  drilled: 'shaky',
  open: 'broken',
  unverified: 'quiet',
}

function FindingRow({ finding }: { finding: Finding }) {
  const head = headlineOf(finding)
  return (
    <article className="rounded-md border border-edge bg-[#111720] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={head.tone}>{head.text}</Tag>
        <Tag>
          confidence {confidenceWord(finding.confidence)} · {finding.confidence.toFixed(2)}
        </Tag>
        <Tag>judged at {finding.level}</Tag>
        <Tag>
          rubric {finding.rubric.id} v{finding.rubric.version}
        </Tag>
      </div>
      <p className="mt-2 text-sm">{finding.rationale}</p>
      <p className="mt-2 text-[11px] text-quiet">
        {finding.evidenceIds.length} evidence citation{finding.evidenceIds.length === 1 ? '' : 's'}{' '}
        · {finding.transcriptSpanIds.length} transcript span
        {finding.transcriptSpanIds.length === 1 ? '' : 's'} · {finding.modelVersion} · prompt{' '}
        {finding.promptVersion}
      </p>
    </article>
  )
}

export function CompetenceLaneView({ lane }: { lane: CompetenceLane }) {
  const topicById = useTopicById()
  return (
    <div className="space-y-4">
      {lane.plan !== undefined && <ImprovementPlanView plan={lane.plan} />}
      <div className="flex flex-wrap gap-2">
        <Tag tone="quiet">pressure reached {lane.pressureReached}</Tag>
        <Tag tone={lane.abstentions > 0 ? 'quiet' : 'held'}>
          {lane.abstentions} abstention{lane.abstentions === 1 ? '' : 's'}
        </Tag>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-accent">Findings</h3>
        {lane.findings.length === 0 ? (
          <Empty>No current findings. Check uncertainty and the feedback audit below.</Empty>
        ) : (
          <div className="space-y-2">
            {lane.findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm text-accent">Gaps touched</h3>
        {lane.gaps.length === 0 ? (
          <Empty>No gaps touched.</Empty>
        ) : (
          <ul className="space-y-2">
            {lane.gaps.map((gap) => {
              const topic = topicById(gap.topicId)
              return (
                <li key={gap.id} className="rounded-md border border-edge bg-[#111720] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={GAP_TONE[gap.status]}>{words(gap.status)}</Tag>
                    {topic !== undefined && <TopicChip topic={topic} />}
                    <Tag>{words(gap.competency)}</Tag>
                    <span className="text-[11px] text-quiet">opened {day(gap.openedAt)}</span>
                  </div>
                  <p className="mt-2 text-sm">{gap.summary}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function ImprovementPlanView({ plan }: { plan: NonNullable<CompetenceLane['plan']> }) {
  const priority = (item: (typeof plan.leading)[number]) => (
    <article key={item.gapId} className="rounded border border-edge p-4">
      <p className="text-sm font-medium">{item.summary}</p>
      {item.quotes.map((quote) => (
        <blockquote key={quote.id} className="mt-2 border-l-2 border-accent/40 pl-3 text-xs">
          “{quote.quoted}” <span className="text-quiet">· {quote.id}</span>
        </blockquote>
      ))}
      {item.explanation !== undefined && (
        <details className="mt-3 text-xs">
          <summary>Practice guidance and exercise</summary>
          <p className="mt-2">{item.explanation}</p>
          <p className="mt-2">{item.exercise}</p>
        </details>
      )}
      {item.explanation === undefined && (
        <p className="mt-2 text-xs text-quiet">
          No authored reference is linked for this source-specific gap.
        </p>
      )}
      {item.nextAction === 'drill' && (
        <Link
          className="journey-secondary mt-3"
          to={`/session?mode=drill&gapId=${encodeURIComponent(item.gapId)}`}
        >
          Practise this priority
        </Link>
      )}
      {item.nextAction === 'transfer' && (
        <Link
          className="journey-secondary mt-3 ml-2"
          to={`/session?mode=transfer&gapId=${encodeURIComponent(item.gapId)}`}
        >
          Check on an unfamiliar variant
        </Link>
      )}
      {item.nextAction === 'unavailable' && (
        <p className="mt-2 text-xs text-quiet">
          No eligible practice target or unfamiliar retest is available. Previously exposed variants
          are not reused as new tests.
        </p>
      )}
      <p className="mt-2 text-xs text-quiet">
        A separate unfamiliar variant is required to verify transfer. This plan does not claim that
        retest happened.
      </p>
    </article>
  )
  return (
    <section className="space-y-3" aria-label="Improvement plan">
      <h3 className="text-sm text-accent">Leading practice priorities</h3>
      {plan.leading.length === 0 ? (
        <Empty>No supported practice priority is available from this session.</Empty>
      ) : (
        plan.leading.map(priority)
      )}
      {plan.remaining.length > 0 && (
        <details>
          <summary className="text-sm">Other distinct priorities</summary>
          <div className="mt-3 space-y-3">{plan.remaining.map(priority)}</div>
        </details>
      )}
      <h3 className="pt-3 text-sm text-accent">What held up</h3>
      {plan.strengths.length === 0 && (
        <p className="text-xs text-quiet">No supported strength is recorded.</p>
      )}
      {plan.strengths.map((item, index) => (
        <div key={index} className="text-xs">
          <p>{item.summary}</p>
          {item.quotes.map((quote) => (
            <blockquote key={quote.id} className="mt-2 pl-3">
              “{quote.quoted}”
            </blockquote>
          ))}
        </div>
      ))}
      <h3 className="pt-3 text-sm text-accent">Uncertainty and review</h3>
      {plan.uncertainty.length === 0 && (
        <p className="text-xs text-quiet">No abstention or pending review is recorded.</p>
      )}
      {plan.uncertainty.map((item, index) => (
        <p key={index} className="text-xs">
          {item.summary}
        </p>
      ))}
    </section>
  )
}
