import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.ts'
import type { Finding, QuotedEvidence, TurnUpdate } from '../api/types.ts'
import { EvidenceProvider, Highlighted, useEvidence } from '../components/evidence.tsx'
import { FindingCard } from '../components/finding-card.tsx'
import { Recorder } from '../components/recorder.tsx'
import { Button, Failed, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { speak, type SpokenAnswer } from '../lib/voice.ts'
import { words } from '../lib/format.ts'

const LEVELS = ['junior', 'mid', 'senior', 'staff'] as const
const PERSONAS = ['collaborator', 'skeptic', 'bar_raiser', 'rusher'] as const
const MODES = ['simulation', 'coach', 'drill', 'transfer'] as const
const ROUNDS = ['project_deep_dive', 'design_extension', 'behavioral'] as const

interface Exchange {
  question: string
  action: string
  pressureLevel: number
  answer: string | null
}

function PressureLadder({ level, ceiling }: { level: number; ceiling: number }) {
  return (
    <span className="flex items-center gap-1" title="Pressure is dosed, not maximal (§4.3)">
      {[0, 1, 2, 3].map((rung) => (
        <span
          key={rung}
          className={`h-3 w-3 rounded-sm border ${
            rung <= level
              ? 'border-shaky/60 bg-shaky/60'
              : rung <= ceiling
                ? 'border-edge'
                : 'border-edge/40 opacity-40'
          }`}
        />
      ))}
      <span className="ml-1 text-[11px] text-quiet">
        pressure {level} · your ceiling {ceiling}
      </span>
    </span>
  )
}

function Transcript({ exchanges }: { exchanges: readonly Exchange[] }) {
  const evidence = useEvidence()
  return (
    <ol className="space-y-3">
      {exchanges.map((exchange, index) => (
        <li key={index} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone="accent">{words(exchange.action.toLowerCase())}</Tag>
            <Tag>pressure {exchange.pressureLevel}</Tag>
          </div>
          <p className="text-sm">{exchange.question}</p>
          {exchange.answer !== null && (
            <p className="whitespace-pre-wrap rounded-md border border-edge bg-[#0f141b] p-2 text-sm text-quiet">
              <Highlighted text={exchange.answer} quotes={evidence.active} />
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

export function SessionPage() {
  const [params, setParams] = useSearchParams()
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('mid')
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]>('collaborator')
  const [mode, setMode] = useState<(typeof MODES)[number]>('coach')
  const [round, setRound] = useState<(typeof ROUNDS)[number]>('project_deep_dive')
  const [ceiling, setCeiling] = useState(1)
  const [turns, setTurns] = useState(4)

  const [sessionId, setSessionId] = useState<string | null>(params.get('id'))
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [quotes, setQuotes] = useState<QuotedEvidence[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [pressure, setPressure] = useState(1)
  const [closedBy, setClosedBy] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [spoken, setSpoken] = useState<SpokenAnswer | null>(null)
  const [voice, setVoice] = useState(false)
  const [delivery, setDelivery] = useState<Record<string, number | string> | null>(null)
  const answerBox = useRef<HTMLTextAreaElement>(null)
  const lastAttempt = useRef<string | null>(null)

  const absorb = (update: TurnUpdate) => {
    setSessionId(update.sessionId)
    setFindings((current) => [...current, ...update.findings])
    setQuotes((current) => [...current, ...update.quotes])
    setNotices(update.notices)
    if (update.question !== undefined) {
      setPressure(update.question.pressureLevel)
      if (voice) void speak(update.question.text).catch(() => {})
      setExchanges((current) => [
        ...current,
        {
          question: update.question?.text ?? '',
          action: update.question?.action ?? '',
          pressureLevel: update.question?.pressureLevel ?? 0,
          answer: null,
        },
      ])
    }
    if (update.status === 'closed') setClosedBy(update.stoppedBy ?? 'closed')
  }

  const start = useMutation({
    mutationFn: () =>
      api.startSession({
        mode,
        level,
        personaId: persona,
        pressureCeiling: ceiling,
        rounds: [round],
        turnsPerRound: turns,
        drill: true,
      }),
    onSuccess: (update) => {
      setExchanges([])
      setFindings([])
      setQuotes([])
      setClosedBy(null)
      absorb(update as TurnUpdate)
    },
  })

  const reply = useMutation({
    mutationFn: (text: string) => api.answer(sessionId ?? '', text),
    onSuccess: (update) => absorb(update as TurnUpdate),
  })

  useEffect(() => {
    if (sessionId !== null) setParams({ id: sessionId }, { replace: true })
  }, [sessionId, setParams])

  // Delivery is recorded against the attempt the answer belonged to, after the turn is judged, and
  // never travels with the answer — the Evaluator receives the same string a typed answer produces.
  const recordDelivery = async () => {
    if (sessionId === null || spoken === null) return
    try {
      const view = await api.session(sessionId)
      const attemptId = view.transcript
        .filter((entry) => entry.role === 'candidate')
        .at(-1)?.attemptId
      if (attemptId === undefined || attemptId === lastAttempt.current) return
      lastAttempt.current = attemptId
      const recorded = await api.recordDelivery(sessionId, {
        attemptId,
        transcript: spoken.transcript,
        audioMs: spoken.audioMs,
        pauses: spoken.pauses,
      })
      setDelivery(recorded.report as unknown as Record<string, number | string>)
    } catch {
      // Delivery is an observation beside the interview; failing to record one costs nothing else.
    }
  }

  const send = () => {
    if (answer.trim() === '' || sessionId === null) return
    setExchanges((current) =>
      current.map((exchange, index) =>
        index === current.length - 1 ? { ...exchange, answer } : exchange,
      ),
    )
    reply.mutate(answer, { onSuccess: () => void recordDelivery() })
    setAnswer('')
    setSpoken(null)
    answerBox.current?.focus()
  }

  const live = sessionId !== null && closedBy === null

  return (
    <EvidenceProvider>
      <div className="space-y-4">
        {!live && (
          <Panel
            title="Set up the interview"
            subtitle="A persona is a configuration of the policy, not a prompt vibe — the difference shows up in the plan."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Level">
                <Select value={level} options={LEVELS} onChange={setLevel} />
              </Field>
              <Field label="Persona">
                <Select value={persona} options={PERSONAS} onChange={setPersona} />
              </Field>
              <Field label="Mode">
                <Select value={mode} options={MODES} onChange={setMode} />
              </Field>
              <Field label="Round">
                <Select value={round} options={ROUNDS} onChange={setRound} />
              </Field>
              <Field label="Pressure ceiling">
                <input
                  type="range"
                  min={0}
                  max={3}
                  value={ceiling}
                  onChange={(event) => setCeiling(Number(event.target.value))}
                  className="w-full"
                />
              </Field>
              <Field label="Turns">
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={turns}
                  onChange={(event) => setTurns(Number(event.target.value))}
                  className="w-full rounded border border-edge bg-[#0f141b] px-2 py-1"
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button tone="primary" onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? 'starting…' : 'Start interview'}
              </Button>
              <PressureLadder level={ceiling} ceiling={3} />
            </div>
            {start.isError && (
              <div className="mt-3">
                <Failed error={start.error} />
              </div>
            )}
          </Panel>
        )}

        {sessionId !== null && (
          <Panel
            title="Interview"
            subtitle={`session ${sessionId}`}
            actions={<PressureLadder level={pressure} ceiling={ceiling} />}
          >
            <Transcript exchanges={exchanges} />

            {live && (
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-quiet">
                    <input
                      type="checkbox"
                      checked={voice}
                      onChange={(event) => setVoice(event.target.checked)}
                    />
                    read questions aloud and let me answer by voice
                  </label>
                  {voice && (
                    <Recorder
                      onAnswer={(heard) => {
                        setSpoken(heard)
                        setAnswer(heard.transcript)
                      }}
                    />
                  )}
                </div>
                <textarea
                  ref={answerBox}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={4}
                  placeholder="Answer in your own words. The evaluator can only cite what appears here."
                  className="w-full rounded-md border border-edge bg-[#0f141b] p-3 text-sm outline-none focus:border-accent/50"
                />
                <div className="mt-2 flex items-center gap-3">
                  <Button tone="primary" onClick={send} disabled={reply.isPending}>
                    {reply.isPending ? 'judging…' : 'Send answer'}
                  </Button>
                  <Quiet>
                    Say &ldquo;I don&rsquo;t know&rdquo; when you don&rsquo;t. That is scored as
                    composure holding, not as a miss.
                  </Quiet>
                </div>
                {reply.isError && (
                  <div className="mt-3">
                    <Failed error={reply.error} />
                  </div>
                )}
              </div>
            )}

            {closedBy !== null && (
              <p className="mt-3 text-sm text-quiet">
                session closed — stopped by {words(closedBy)}
              </p>
            )}
          </Panel>
        )}

        {delivery !== null && (
          <Panel
            title="Delivery"
            subtitle="Observations about how you spoke. They say nothing about whether the answer was any good, and they never reach a finding or the gap ledger."
          >
            <div className="flex flex-wrap gap-2">
              <Tag>{Number(delivery['wordsPerMinute']).toFixed(0)} words/min</Tag>
              <Tag>{delivery['longPauseCount']} long pauses</Tag>
              <Tag>
                {Number(delivery['fillerRatePerHundredWords']).toFixed(1)} fillers per 100 words
              </Tag>
            </div>
          </Panel>
        )}

        {notices.length > 0 && (
          <Panel title="Notices">
            <ul className="space-y-1 text-sm text-quiet">
              {notices.map((notice, index) => (
                <li key={index}>{notice}</li>
              ))}
            </ul>
          </Panel>
        )}

        {findings.length > 0 && (
          <Panel
            title="Findings"
            subtitle="Hover one to see the exact words it came from, highlighted in what you said."
          >
            <div className="space-y-2">
              {findings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} quotes={quotes} />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </EvidenceProvider>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-quiet">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly T[]
  onChange: (next: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="w-full rounded border border-edge bg-[#0f141b] px-2 py-1 text-sm"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  )
}
