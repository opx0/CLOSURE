import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import { JourneyIcon, JourneyLink, PreparationGrid } from '../components/journey.tsx'
import { Empty, Failed, Loading, Tag } from '../components/primitives.tsx'
import {
  ROUND_BLURB,
  ROUND_LABEL,
  inRoundOrder,
  isRound,
  roundsAbout,
  useTopicCatalog,
} from '../lib/catalog.ts'
import { useClaimSet, usePreparation } from '../lib/claim-set.ts'

export function PreparePage() {
  const catalog = useTopicCatalog()
  const [params, setParams] = useSearchParams()
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots })
  const claims = useClaimSet()
  const preparation = usePreparation()
  const history = useQuery({ queryKey: ['sessions'], queryFn: api.sessions })
  if (catalog.isLoading) return <Loading what="your preparation options" />
  if (catalog.isError) return <Failed error={catalog.error} />
  const data = catalog.data
  if (data === undefined) return null
  const role = data.roles.find((entry) => entry.id === params.get('role')) ?? data.roles[0]
  if (role === undefined) return <Empty>No interview roles are configured.</Empty>
  const level = data.levels.find((entry) => entry === params.get('level')) ?? role.defaultLevel
  const rounds = params.has('rounds')
    ? inRoundOrder(
        data,
        (params.get('rounds') ?? '').split(',').filter((value) => isRound(data, value)),
      )
    : role.defaultRounds.slice(0, 1)
  const mode = params.get('mode') === 'simulation' ? 'simulation' : 'coach'
  const interviewRounds = roundsAbout(data, 'topic')
  const configured = new URLSearchParams(params)
  configured.set('role', role.id)
  configured.set('level', level)
  configured.set('rounds', rounds.join(','))
  configured.set('mode', mode)
  configured.delete('snapshotId')
  const setup = `/session?${configured}`
  const returnTo = `/prepare?${configured}`
  const update = (changes: Record<string, string | undefined>) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) next.delete(key)
        else next.set(key, value)
      }
      return next
    })
  }
  const active = history.data?.sessions.find((entry) => entry.availability === 'awaiting_answer')
  const liveSnapshots = snapshots.data?.snapshots.filter((entry) => !entry.deleted) ?? []

  return (
    <div className="journey-page studio-prepare">
      <header className="preparation-hero">
        <PreparationGrid />
        <div className="preparation-hero-copy">
          <p className="hero-label">
            <span />
            Software engineering interview practice
          </p>
          <h1 aria-label="Prepare">
            Think it through.
            <br />
            Say it out loud.
          </h1>
          <p className="hero-description">
            Practise the interview. Get feedback grounded in your answers.
            <br className="desktop-break" /> Understand what held up, and what to work on next.
          </p>
          <div className="hero-actions">
            {rounds.length > 0 ? (
              <Link to={setup} className="journey-primary">
                Start an interview <JourneyIcon name="arrow" className="size-4" />
              </Link>
            ) : (
              <p role="status" className="text-sm text-shaky">
                Choose at least one round to continue.
              </p>
            )}
            <a href="#interview-setup" className="journey-secondary">
              Customize your interview <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="hero-context">
            {role.label}
            <span> / </span>
            {level}
            <span> / </span>
            {rounds.length} {rounds.length === 1 ? 'round' : 'rounds'}
            <span> / </span>
            {mode === 'coach' ? 'Coach' : 'Simulation'}
          </p>
        </div>
        <div className="hero-rounds" aria-label="Interview coverage">
          {interviewRounds.map((round) => (
            <span key={round}>{ROUND_LABEL[round]}</span>
          ))}
        </div>
      </header>
      <section id="interview-setup" className="interview-builder" aria-labelledby="builder-title">
        <div className="builder-heading">
          <div>
            <p className="journey-eyebrow">Your practice, your parameters</p>
            <h2 id="builder-title">Build your next interview.</h2>
          </div>
          <p>
            Choose the role, level and rounds.
            <br />
            Your résumé is optional. Your thinking isn’t.
          </p>
        </div>
        <div className="prepare-layout">
          <section className="preparation-editor">
            <div className="preparation-section-heading">
              <div>
                <p className="studio-caption">01 / Interview context</p>
                <h3>What are you preparing for?</h3>
              </div>
              <span className="journey-icon">
                <JourneyIcon name="interview" />
              </span>
            </div>
            <div className="prepare-context-grid">
              <label className="block text-xs font-medium text-muted">
                Interview role
                <select
                  aria-label="Interview role"
                  value={role.id}
                  onChange={(event) => update({ role: event.target.value, rounds: undefined })}
                  className="journey-select mt-2"
                >
                  {data.roles.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-xs font-medium text-muted">Your level</legend>
                <div className="journey-segment mt-2">
                  {data.levels.map((entry) => (
                    <button
                      type="button"
                      key={entry}
                      aria-pressed={level === entry}
                      onClick={() => update({ level: entry })}
                    >
                      {entry[0]?.toUpperCase()}
                      {entry.slice(1)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <fieldset className="mt-7">
              <legend className="text-xs font-medium text-muted">02 / Choose your rounds</legend>
              <p className="mt-1 text-xs text-quiet">
                Choose one round or put together a full interview.
              </p>
              <div className="round-catalogue">
                {interviewRounds.map((round, index) => (
                  <button
                    type="button"
                    key={round}
                    aria-label={ROUND_LABEL[round]}
                    aria-pressed={rounds.includes(round)}
                    className="round-option ring-focus"
                    data-number={`0${index + 1}`}
                    onClick={() =>
                      update({
                        rounds: inRoundOrder(
                          data,
                          rounds.includes(round)
                            ? rounds.filter((entry) => entry !== round)
                            : [...rounds, round],
                        ).join(','),
                      })
                    }
                  >
                    <span className="round-copy">
                      <span className="round-name">{ROUND_LABEL[round]}</span>
                      <span className="round-description">{ROUND_BLURB[round]}</span>
                    </span>
                    <span className="round-check">
                      {rounds.includes(round) && <JourneyIcon name="check" className="size-3" />}
                      {!rounds.includes(round) && <span aria-hidden="true">+</span>}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-edge pt-5">
              <p className="max-w-xs text-xs leading-relaxed text-quiet">
                Coding practice is spoken reasoning, algorithm tracing and code discussion.
              </p>
              <Link to="/resume" className="text-xs font-medium text-accent-soft">
                Cross-question my résumé
              </Link>
            </div>
          </section>
          <aside className="prepare-side">
            <section className="session-ticket">
              <p className="journey-eyebrow">Your interview brief</p>
              <h2 className="ticket-role">{role.label}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <Tag tone="accent">{level}</Tag>
                <Tag>{mode}</Tag>
              </div>
              <label className="mt-5 block text-xs text-quiet">
                Feedback timing
                <select
                  aria-label="Feedback timing"
                  value={mode}
                  onChange={(event) => update({ mode: event.target.value })}
                  className="journey-select mt-2 text-sm"
                >
                  <option value="coach">Coach · after each answer</option>
                  <option value="simulation">Simulation · after each round</option>
                </select>
              </label>
              <p className="mt-5 text-xs text-quiet">
                {rounds.length} {rounds.length === 1 ? 'round' : 'rounds'} selected
              </p>
              <ul className="mt-5 space-y-3">
                {rounds.map((round) => (
                  <li key={round} className="flex items-center gap-2 text-sm text-muted">
                    <JourneyIcon name="check" className="size-4 text-accent-soft" />
                    {ROUND_LABEL[round]}
                  </li>
                ))}
              </ul>
              {rounds.length > 0 && (
                <Link to={setup} className="journey-primary mt-6 w-full">
                  Review interview setup <JourneyIcon name="arrow" className="size-4" />
                </Link>
              )}
              <p className="mt-3 text-[11px] text-quiet">
                Nothing starts until you confirm your setup.
              </p>
            </section>
            <section className="preparation-material">
              <div className="flex items-center gap-2 text-sm font-medium">
                <JourneyIcon name="file" className="size-4 text-quiet" />
                Optional preparation material
              </div>
              <p className="mt-2 text-xs leading-relaxed text-quiet">
                A résumé and a pinned project add context. Neither is needed for a topic interview.
              </p>
              {claims.data !== undefined && (
                <p className="mt-3 text-xs text-muted">
                  {claims.data.confirmed.size} confirmed résumé claim
                  {claims.data.confirmed.size === 1 ? '' : 's'}
                </p>
              )}
              {preparation.isError && <Failed error={preparation.error} />}
              {preparation.save.isError && <Failed error={preparation.save.error} />}
              {claims.data !== undefined && claims.data.confirmed.size > 0 && (
                <fieldset className="mt-3 space-y-2">
                  <legend className="text-xs text-quiet">Claims for this interview</legend>
                  {claims.data.claims
                    .filter((claim) => claims.data!.confirmed.has(claim.id))
                    .map((claim) => {
                      const selected = preparation.data?.selection?.claimIds ?? [
                        ...claims.data!.confirmed,
                      ]
                      return (
                        <label key={claim.id} className="flex gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={selected.includes(claim.id)}
                            disabled={preparation.isPending || preparation.save.isPending}
                            onChange={(event) =>
                              preparation.save.mutate({
                                ...preparation.data?.selection,
                                claimIds: event.target.checked
                                  ? [...selected, claim.id]
                                  : selected.filter((id) => id !== claim.id),
                              })
                            }
                          />
                          {claim.assertion}
                        </label>
                      )
                    })}
                </fieldset>
              )}
              {liveSnapshots.length > 0 && (
                <label className="mt-3 block text-xs text-quiet">
                  Pinned project
                  <select
                    aria-label="Pinned project"
                    value={preparation.data?.selection?.snapshotId ?? ''}
                    disabled={preparation.isPending || preparation.save.isPending}
                    onChange={(event) =>
                      preparation.save.mutate({
                        claimIds: preparation.data?.selection?.claimIds ?? [
                          ...(claims.data?.confirmed ?? []),
                        ],
                        ...(event.target.value ? { snapshotId: event.target.value } : {}),
                      })
                    }
                    className="journey-select mt-2 text-xs"
                  >
                    <option value="">Choose when needed</option>
                    {liveSnapshots.map((snapshot) => (
                      <option key={snapshot.id} value={snapshot.id}>
                        {snapshot.repoPath.split('/').at(-1)} · {snapshot.commit.slice(0, 7)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Link
                to={`/resume?returnTo=${encodeURIComponent(returnTo)}`}
                className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-accent-soft"
              >
                Add preparation material <JourneyIcon name="arrow" className="size-3" />
              </Link>
            </section>
            {active !== undefined && (
              <JourneyLink
                to={`/session?id=${encodeURIComponent(active.session.id)}`}
                title="Continue your interview"
                description="Your saved conversation is ready when you are."
                icon="history"
              />
            )}
          </aside>
        </div>
      </section>
      <div className="journey-assurance">
        <JourneyIcon name="shield" className="size-4 shrink-0" />
        <p>
          Practice only. Feedback cites your words, uncertainty stays visible, and there is no
          readiness score.
        </p>
      </div>
    </div>
  )
}
