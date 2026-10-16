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
      <div className="flex flex-wrap gap-2">
        <Tag tone="quiet">pressure reached {lane.pressureReached}</Tag>
        <Tag tone={lane.abstentions > 0 ? 'quiet' : 'held'}>
          {lane.abstentions} abstention{lane.abstentions === 1 ? '' : 's'}
        </Tag>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-accent">Findings</h3>
        {lane.findings.length === 0 ? (
          <Empty>No findings — the evaluator judged nothing in this session.</Empty>
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
