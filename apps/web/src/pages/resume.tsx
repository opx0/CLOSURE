import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import type { PinnedSnapshot, ResumeFeedbackResponse } from '../api/types.ts'
import { Button, Empty, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { useClaimSet } from '../lib/claim-set.ts'
import { day } from '../lib/format.ts'
import { ResumeClaims } from './claims.tsx'

type Line = ResumeFeedbackResponse['lines'][number]
type ResumeTag = Line['tags'][number]

const TAG: Record<
  ResumeTag['kind'],
  { label: string; tone: 'held' | 'shaky' | 'broken' | 'quiet' }
> = {
  held: { label: 'held up', tone: 'held' },
  linked_code: { label: 'files that share its words', tone: 'quiet' },
  partially_supported: { label: 'partially supported', tone: 'shaky' },
  contradicted: { label: 'contradicted', tone: 'broken' },
  open_gap: { label: 'open gap', tone: 'broken' },
  implied_unconfirmed: { label: 'implied, not confirmed', tone: 'shaky' },
  no_metric: { label: 'no number', tone: 'shaky' },
  no_code_evidence: { label: 'no linked code', tone: 'shaky' },
  code_not_checked: { label: 'code not checked', tone: 'quiet' },
}

const JOB_RUNNING = new Set(['queued', 'leased'])

function walkthrough(snapshotId: string): string {
  return `/session?rounds=code_walkthrough&snapshotId=${encodeURIComponent(snapshotId)}`
}

function repoName(path: string): string {
  return path.replace(/\/+$/, '').split('/').at(-1) ?? path
}

function ProjectCard({ project }: { project: PinnedSnapshot }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-white/[0.02] p-4">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-body">{repoName(project.repoPath)}</p>
        <p className="mono mt-0.5 truncate text-[12px] text-quiet">{project.repoPath}</p>
        <p className="mt-2 text-[12px] text-quiet">
          commit <span className="mono text-muted">{project.commit.slice(0, 7)}</span> ·{' '}
          {project.fileCount} files · {project.artifactCount} artifacts · pinned{' '}
          {day(project.pinnedAt)}
        </p>
      </div>
      <Link
        to={walkthrough(project.id)}
        className="ring-focus inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-accent to-[#6f5cf0] px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(139,123,255,0.7)] transition hover:brightness-110"
      >
        Walk me through this project <span aria-hidden>→</span>
      </Link>
    </li>
  )
}

function Projects() {
  const queryClient = useQueryClient()
  const [repoPath, setRepoPath] = useState('')
  const [ref, setRef] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots })

  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId ?? ''),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      JOB_RUNNING.has(query.state.data?.job.state ?? 'queued') ? 1_000 : false,
  })
  const jobState = job.data?.job.state
  useEffect(() => {
    if (jobState !== 'succeeded') return
    setJobId(null)
    setRepoPath('')
    setRef('')
    void queryClient.invalidateQueries()
  }, [jobState, queryClient])

  const pin = useMutation({
    mutationFn: () => api.pinSnapshot(repoPath.trim(), ref.trim() === '' ? undefined : ref.trim()),
    onSuccess: (result) => {
      if ('snapshot' in result) {
        setRepoPath('')
        setRef('')
        void queryClient.invalidateQueries()
      } else {
        setJobId(result.job.id)
      }
    },
  })

  const live = (snapshots.data?.snapshots ?? []).filter((project) => !project.deleted)
  const waiting = pin.isPending || (jobId !== null && JOB_RUNNING.has(jobState ?? 'queued'))

  return (
    <Panel
      icon="3"
      title="Your projects"
      subtitle="Pin a repository you built. The interviewer opens its real files and functions and asks you to explain them: what they do, why they are written that way, and what breaks them."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Path to a local git repository"
          value={repoPath}
          onChange={(event) => setRepoPath(event.target.value)}
          placeholder="/home/you/projects/my-app"
          className="ring-focus mono min-w-0 flex-1 rounded-xl border border-edge bg-ink-2 px-3.5 py-2 text-sm text-body placeholder:text-quiet/60"
        />
        <input
          aria-label="Branch, tag or commit (optional)"
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder="branch or commit"
          className="ring-focus mono rounded-xl border border-edge bg-ink-2 px-3.5 py-2 text-sm text-body placeholder:text-quiet/60 sm:w-56"
        />
        <Button
          tone="primary"
          onClick={() => pin.mutate()}
          disabled={waiting || repoPath.trim() === ''}
        >
          {waiting ? 'reading the repository…' : 'Pin project'}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-quiet">
        Read from your own disk at one commit, in a separate process with hard limits. Delete a
        pinned project any time under{' '}
        <Link to="/privacy" className="text-accent-soft underline underline-offset-2">
          Your data
        </Link>
        .
      </p>
      {jobId !== null && jobState !== undefined && JOB_RUNNING.has(jobState) && (
        <p className="mt-2 text-[13px] text-quiet">
          Queued for a worker ({jobState}). It shows up below once parsed.
        </p>
      )}
      {(jobState === 'failed' || jobState === 'dead') && (
        <div className="mt-3">
          <Failed error={`repository not pinned: ${job.data?.job.lastError ?? jobState}`} />
        </div>
      )}
      {pin.isError && (
        <div className="mt-3">
          <Failed error={pin.error} />
        </div>
      )}

      <div className="mt-5">
        {snapshots.isLoading && <Loading what="your projects" />}
        {snapshots.isError && <Failed error={snapshots.error} />}
        {snapshots.data !== undefined && live.length === 0 && (
          <Empty>
            No project pinned yet. Paste the full path to a git repository on this machine, then ask
            the interviewer to walk you through it.
          </Empty>
        )}
        {live.length > 0 && (
          <ul className="space-y-2">
            {live.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

function FeedbackLine({ line, assertions }: { line: Line; assertions: Map<string, string> }) {
  const byClaim = new Map<string, ResumeTag[]>()
  for (const tag of line.tags) byClaim.set(tag.claimId, [...(byClaim.get(tag.claimId) ?? []), tag])

  return (
    <li className="rounded-xl border border-edge bg-white/[0.02] p-4">
      <blockquote className="border-l-2 border-accent/60 pl-3 text-[15px] leading-relaxed text-body">
        {line.text}
      </blockquote>
      <div className="mt-3 space-y-4">
        {[...byClaim].map(([claimId, tags]) => (
          <div key={claimId}>
            {byClaim.size > 1 && (
              <p className="mb-2 text-[12px] text-quiet">
                about: {assertions.get(claimId) ?? claimId}
              </p>
            )}
            <ul className="space-y-3">
              {tags.map((tag) => (
                <li key={tag.kind} className="grid gap-1.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
                  <span>
                    <Tag tone={TAG[tag.kind].tone}>{TAG[tag.kind].label}</Tag>
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[13px] leading-relaxed text-muted">{tag.advice}</p>
                    {tag.quotes.map((quote) => (
                      <p
                        key={quote}
                        className="border-l-2 border-held/50 pl-3 text-[13px] text-held"
                      >
                        you said: &ldquo;{quote}&rdquo;
                      </p>
                    ))}
                    {tag.artifactPaths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tag.artifactPaths.map((path) => (
                          <span
                            key={path}
                            className="mono rounded-md border border-edge bg-ink-2 px-2 py-0.5 text-[12px] text-muted"
                          >
                            {path}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </li>
  )
}

function Feedback() {
  const feedback = useQuery({ queryKey: ['resume-feedback'], queryFn: api.resumeFeedback })
  const claimSet = useClaimSet()
  const assertions = new Map(
    (claimSet.data?.claims ?? []).map((claim) => [claim.id, claim.assertion]),
  )

  return (
    <Panel
      icon="4"
      title="Résumé feedback"
      subtitle="Line by line: what held when you were cross-questioned, what your own answers contradicted, what is vague, and which lines no pinned file even shares words with. Each note carries its evidence. No score, and no rewritten résumé."
    >
      {feedback.isLoading && <Loading what="feedback on your résumé" />}
      {feedback.isError && <Failed error={feedback.error} />}
      {feedback.data !== undefined && feedback.data.lines.length === 0 && (
        <Empty>
          Feedback appears here, one résumé line at a time, once your résumé is extracted. It gets
          sharper after you are cross-questioned and after you pin the project behind a line.
        </Empty>
      )}
      {feedback.data !== undefined && feedback.data.lines.length > 0 && (
        <ul className="space-y-3">
          {feedback.data.lines.map((line) => (
            <FeedbackLine key={line.spanId} line={line} assertions={assertions} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function ResumePage() {
  const [params] = useSearchParams()
  const requestedReturn = params.get('returnTo')
  const returnTo = requestedReturn?.startsWith('/prepare?') ? requestedReturn : '/prepare'
  return (
    <div className="space-y-5">
      <Link to={returnTo} className="text-xs font-medium text-accent-soft">
        Back to Prepare
      </Link>
      <section className="rise relative overflow-hidden rounded-[20px] border border-edge bg-gradient-to-b from-panel-2 to-ink-2 px-6 py-8 shadow-[var(--shadow-float)] sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-accent/15 blur-3xl"
        />
        <div className="relative max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-body sm:text-3xl">
            Résumé &amp; projects
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Two jobs. Make every line of your résumé something you can defend, and let the
            interviewer cross-question it, down to the files in the projects behind it.
          </p>
        </div>
      </section>

      <ResumeClaims />
      <Projects />
      <Feedback />

      <Quiet>
        Your résumé and your code are treated as untrusted input: read, quoted and cited, never
        followed as instructions. A repository shows what deserves a question; it never proves who
        wrote the code or what you understand.
      </Quiet>
    </div>
  )
}
