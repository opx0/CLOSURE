import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type KinematicsReportBody, type ProsodyReportBody } from '../api/client.ts'
import { measurePauses, transcribe, voiceUrl } from '../lib/voice.ts'
import {
  startKinematicsCapture,
  type KinematicsCapture,
  type KinematicsReport,
} from '../lib/vision/index.ts'
import { PerformanceDisclaimer } from '../components/lane.tsx'
import { Button, Failed, Loading, Panel, Quiet, Tag } from '../components/primitives.tsx'
import { TopicChip } from '../components/question.tsx'
import { useTopicById } from '../lib/catalog.ts'

// The performance-lane boundary literal. Repeated here rather than imported so the browser bundle
// stays free of the contracts runtime; the generated request type checks that it stays correct.
const BOUNDARY = 'observation_only_never_competence'

// Vocalised hesitations. A "filled pause" is a sound like um, not a discourse marker like "like".
const FILLED_PAUSE_TOKENS = new Set(['um', 'uh', 'erm', 'uhm', 'em', 'ah', 'mm'])
// Mirrors DISCOURSE_MARKERS in @levelhead/contracts; a single-token subset plus the bigrams below.
const MARKER_TOKENS = new Set([
  'like',
  'basically',
  'actually',
  'literally',
  'right',
  'obviously',
  'essentially',
])
const MARKER_BIGRAMS = new Set(['you know', 'i mean', 'sort of', 'kind of'])
const REPAIR_BIGRAMS = new Set(['i mean'])
const REPAIR_TOKENS = new Set(['sorry'])
const PAUSE_MS = 250
const HESITATION_WINDOW_MS = 3_000
const PROLONGATION_MULTIPLE = 3
const CLAUSE_END = /[.,;:!?]$/

interface SidecarProsody {
  audioMs: number
  words: { text: string; startMs: number; endMs: number }[]
  sentences: { words: number; endsRising: boolean }[]
  pitch: {
    medianHz: number
    p10Hz: number
    p90Hz: number
    rangeSemitones: number
    coefficientOfVariation: number
  }
  intensity: { medianDb: number; endOfTurnDropDb: number }
}

async function measureProsody(blob: Blob): Promise<SidecarProsody> {
  const response = await fetch(`${voiceUrl()}/prosody`, {
    method: 'POST',
    headers: { 'content-type': blob.type },
    body: blob,
  })
  if (!response.ok) throw new Error(`the voice service answered ${response.status}`)
  return (await response.json()) as SidecarProsody
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?]+$/, '')
    .trim()
}

function positionOf(
  atMs: number,
  words: SidecarProsody['words'],
): 'mid_clause' | 'clause_boundary' {
  let preceding: SidecarProsody['words'][number] | undefined
  for (const word of words) {
    if (word.endMs <= atMs) preceding = word
    else break
  }
  return preceding !== undefined && CLAUSE_END.test(preceding.text)
    ? 'clause_boundary'
    : 'mid_clause'
}

// Everything here is a real measurement of the recording: acoustics and word timings from the local
// voice sidecar, silences from the browser's own analysis of the waveform. Nothing is invented. It
// is a lighter pipeline than the server's canonical one, so it is labelled as browser-measured and
// never claimed to reproduce it.
function assembleProsody(
  attemptId: string,
  sidecar: SidecarProsody,
  silences: { atMs: number; durationMs: number }[],
): ProsodyReportBody {
  const words = sidecar.words

  const pauses: ProsodyReportBody['pauses'] = []
  for (const silence of silences) {
    if (silence.durationMs < PAUSE_MS) continue
    pauses.push({ ...silence, kind: 'unfilled', position: positionOf(silence.atMs, words) })
  }
  for (const word of words) {
    if (FILLED_PAUSE_TOKENS.has(normalize(word.text))) {
      pauses.push({
        atMs: word.startMs,
        durationMs: Math.max(0, word.endMs - word.startMs),
        kind: 'filled',
        position: positionOf(word.startMs, words),
      })
    }
  }
  pauses.sort((a, b) => a.atMs - b.atMs)

  let discourseMarkers = 0
  let repairs = 0
  let restarts = 0
  let prolongations = 0
  const tokens = words.map((word) => normalize(word.text))
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    const next = tokens[index + 1]
    if (MARKER_TOKENS.has(token)) discourseMarkers += 1
    if (REPAIR_TOKENS.has(token)) repairs += 1
    if (index > 0 && token !== '' && token === tokens[index - 1]) restarts += 1
    if (next !== undefined) {
      const bigram = `${token} ${next}`
      if (MARKER_BIGRAMS.has(bigram)) discourseMarkers += 1
      if (REPAIR_BIGRAMS.has(bigram)) repairs += 1
    }
  }
  const durations = words
    .map((word) => Math.max(0, word.endMs - word.startMs))
    .filter((ms) => ms > 0)
  const sorted = [...durations].sort((a, b) => a - b)
  const medianDuration = sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] ?? 0)
  if (medianDuration > 0) {
    for (const word of words) {
      const duration = Math.max(0, word.endMs - word.startMs)
      if (duration > medianDuration * PROLONGATION_MULTIPLE && normalize(word.text).length <= 4) {
        prolongations += 1
      }
    }
  }

  const eventTimes = pauses.map((pause) => pause.atMs)
  const hesitationClusters: ProsodyReportBody['hesitationClusters'] = []
  let clusterStart: number | null = null
  let clusterEnd = 0
  let clusterCount = 0
  const flush = () => {
    if (clusterStart !== null && clusterCount >= 2) {
      hesitationClusters.push({
        atMs: clusterStart,
        durationMs: clusterEnd - clusterStart,
        events: clusterCount,
      })
    }
    clusterStart = null
    clusterCount = 0
  }
  for (const time of eventTimes) {
    if (clusterStart !== null && time - clusterEnd > HESITATION_WINDOW_MS) flush()
    clusterStart ??= time
    clusterEnd = time
    clusterCount += 1
  }
  flush()

  return {
    attemptId,
    audioMs: sidecar.audioMs,
    words,
    pauses,
    hesitationClusters,
    disfluencies: { repairs, restarts, prolongations, discourseMarkers },
    pitch: {
      ...sidecar.pitch,
      declarativesCounted: sidecar.sentences.length,
      declarativesEndingRising: sidecar.sentences.filter((sentence) => sentence.endsRising).length,
    },
    intensity: sidecar.intensity,
    // The browser cannot see when the question finished rendering, so these are honestly absent.
    responseLatencyMs: null,
    timeToFirstContentWordMs: null,
    sentenceLengthsWords: sidecar.sentences.map((sentence) => sentence.words),
    boundary: BOUNDARY,
  }
}

interface Recorded {
  attemptId: string
  prosody: ProsodyReportBody | null
  kinematics: KinematicsReportBody | null
}

export function StudioPage() {
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('id')
  const [idField, setIdField] = useState('')

  const [useCamera, setUseCamera] = useState(true)
  const [recState, setRecState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [recProblem, setRecProblem] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [captured, setCaptured] = useState<{
    hasAudio: boolean
    kinematics: KinematicsReport | null
  }>({
    hasAudio: false,
    kinematics: null,
  })
  const [submitState, setSubmitState] = useState<'idle' | 'submitting'>('idle')
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [result, setResult] = useState<Recorded | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const capture = useRef<KinematicsCapture | null>(null)
  const audioBlob = useRef<Blob | null>(null)
  const preview = useRef<HTMLVideoElement | null>(null)

  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.session(sessionId ?? ''),
    enabled: sessionId !== null,
  })

  const events = useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => api.events(sessionId ?? ''),
    enabled: sessionId !== null,
  })
  const topicById = useTopicById()

  const asked = session.data?.transcript.filter((entry) => entry.role === 'interviewer').at(-1)
  const question = asked?.text
  const topic = topicById(
    events.data?.flatMap((event) =>
      event.kind === 'policy_action' && event.payload.attemptId === asked?.attemptId
        ? [event.payload.topicId]
        : [],
    )[0],
  )
  const closed = session.data?.state === 'closed'

  const start = async () => {
    setRecProblem(null)
    setResult(null)
    setNotes([])
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true, video: useCamera })
    } catch (error) {
      setRecProblem(
        `no microphone: ${error instanceof Error ? error.message : String(error)}. You can still type your answer below.`,
      )
      return
    }
    stream.current = media

    if (useCamera && preview.current !== null) {
      preview.current.srcObject = media
      void preview.current.play().catch(() => {})
    }

    chunks.current = []
    const audioOnly = new MediaStream(media.getAudioTracks())
    const rec = new MediaRecorder(audioOnly)
    rec.ondataavailable = (event) => chunks.current.push(event.data)
    rec.start()
    recorder.current = rec

    if (useCamera) {
      try {
        capture.current = await startKinematicsCapture('pending', media)
      } catch (error) {
        capture.current = null
        setNotes((current) => [
          ...current,
          `Camera on, but the vision model did not load (${error instanceof Error ? error.message : String(error)}). Continuing in audio and text — vision is an extra instrument, never a gate.`,
        ])
      }
    }

    setRecState('recording')
  }

  const stop = async () => {
    const rec = recorder.current
    if (rec === null) return
    setRecState('transcribing')

    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      rec.stop()
    })
    const blob = new Blob(chunks.current, { type: rec.mimeType })
    audioBlob.current = blob

    let kinematics: KinematicsReport | null = null
    if (capture.current !== null) {
      try {
        kinematics = await capture.current.stop()
      } catch {
        setNotes((current) => [
          ...current,
          'The kinematics capture could not be summarised; continuing without it.',
        ])
      }
      capture.current = null
    }

    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (preview.current !== null) preview.current.srcObject = null

    setCaptured({ hasAudio: true, kinematics })

    try {
      const text = await transcribe(blob)
      setAnswer(text)
    } catch (error) {
      setRecProblem(
        `could not transcribe (${error instanceof Error ? error.message : String(error)}) — is \`bun run voice:up\` running? Type your answer below instead.`,
      )
    } finally {
      recorder.current = null
      setRecState('idle')
    }
  }

  const submit = async () => {
    if (sessionId === null || answer.trim() === '') return
    setSubmitState('submitting')
    setSubmitError(null)
    const localNotes: string[] = []
    try {
      await api.answer(sessionId, answer)
      const view = await api.session(sessionId)
      const attemptId = view.transcript
        .filter((entry) => entry.role === 'candidate')
        .at(-1)?.attemptId
      if (attemptId === undefined)
        throw new Error('the answer did not produce an attempt to record against')

      let prosody: ProsodyReportBody | null = null
      const blob = audioBlob.current
      if (blob !== null) {
        try {
          const [sidecar, silences] = await Promise.all([measureProsody(blob), measurePauses(blob)])
          prosody = assembleProsody(attemptId, sidecar, silences.pauses)
          await api.recordProsody(sessionId, prosody)
        } catch (error) {
          localNotes.push(
            `Prosody not recorded (${error instanceof Error ? error.message : String(error)}). The voice sidecar measures pitch and timing; without it, this answer is text-only.`,
          )
        }
      } else {
        localNotes.push(
          'No audio captured, so no prosody. Record an answer to add speech and rhythm signals.',
        )
      }

      let kinematics: KinematicsReportBody | null = null
      if (captured.kinematics !== null) {
        kinematics = { ...captured.kinematics, attemptId }
        try {
          await api.recordKinematics(sessionId, kinematics)
        } catch (error) {
          kinematics = null
          localNotes.push(
            `Kinematics not recorded (${error instanceof Error ? error.message : String(error)}).`,
          )
        }
      } else {
        localNotes.push(
          'No kinematics: the camera was off or the vision model did not load. The interview stands on audio and text.',
        )
      }

      setNotes(localNotes)
      setResult({ attemptId, prosody, kinematics })
      setAnswer('')
      audioBlob.current = null
      setCaptured({ hasAudio: false, kinematics: null })
      void session.refetch()
      void events.refetch()
    } catch (error) {
      setSubmitError(error)
    } finally {
      setSubmitState('idle')
    }
  }

  if (sessionId === null) {
    return (
      <Panel
        title="Studio"
        subtitle="Answer a live interview question aloud, and capture how you delivered it."
      >
        <p className="mb-3 text-sm text-quiet">
          <Link to="/session" className="text-accent underline underline-offset-2">
            Start an interview
          </Link>{' '}
          and choose &ldquo;Answer this one aloud&rdquo; beside any question, or open a live session
          by its id.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={idField}
            onChange={(event) => setIdField(event.target.value)}
            placeholder="session id"
            className="flex-1 rounded border border-edge bg-[#0f141b] px-2 py-1 text-sm"
          />
          <Button
            tone="primary"
            onClick={() =>
              idField.trim() !== '' && setParams({ id: idField.trim() }, { replace: true })
            }
          >
            Open
          </Button>
        </div>
      </Panel>
    )
  }

  if (session.isLoading) return <Loading what="the session" />
  if (session.isError) return <Failed error={session.error} />

  const recording = recState === 'recording'

  return (
    <div className="space-y-4">
      <Panel title="Studio — practice aloud" subtitle={`session ${sessionId}`}>
        <p className="text-sm text-quiet">
          Speak your answer. Voice and camera are extra instruments: the evaluator only ever sees
          the text, and it sees the same string a typed answer produces. What you record here
          becomes the performance lane of your{' '}
          <Link
            to={`/debrief?id=${sessionId}`}
            className="text-accent underline underline-offset-2"
          >
            debrief
          </Link>
          , never a judgment.
        </p>
        {closed && (
          <p className="mt-2 text-sm text-shaky">
            This session is closed. Answers can only be recorded against a live session — start a
            new one on the interview tab.
          </p>
        )}
      </Panel>

      {question !== undefined && (
        <Panel title="Current question">
          {topic !== undefined && (
            <div className="mb-2">
              <TopicChip topic={topic} />
            </div>
          )}
          <p className="text-sm">{question}</p>
        </Panel>
      )}

      <Panel title="Record">
        <label className="mb-3 flex items-center gap-2 text-xs text-quiet">
          <input
            type="checkbox"
            checked={useCamera}
            onChange={(event) => setUseCamera(event.target.checked)}
            disabled={recording}
          />
          use the camera for kinematics (framing, gaze direction, posture — numbers only, the frames
          never leave your browser)
        </label>

        {useCamera && (
          <video
            ref={preview}
            muted
            playsInline
            className={`mb-3 w-full max-w-sm rounded-md border border-edge ${recording ? '' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {recording ? (
            <Button tone="danger" onClick={() => void stop()}>
              ⏹ Stop
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={recState === 'transcribing'}>
              {recState === 'transcribing' ? 'transcribing…' : '🎙 Record answer'}
            </Button>
          )}
          {captured.hasAudio && !recording && <Tag tone="held">audio captured</Tag>}
          {captured.kinematics !== null && <Tag tone="held">kinematics captured</Tag>}
        </div>
        {recProblem !== null && <p className="mt-2 text-xs text-broken">{recProblem}</p>}

        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={4}
          placeholder="Your answer, transcribed here after recording — or typed. The evaluator can only cite what appears here."
          className="mt-3 w-full rounded-md border border-edge bg-[#0f141b] p-3 text-sm outline-none focus:border-accent/50"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            tone="primary"
            onClick={() => void submit()}
            disabled={submitState === 'submitting' || answer.trim() === '' || closed}
          >
            {submitState === 'submitting' ? 'submitting…' : 'Submit answer & record delivery'}
          </Button>
          <Quiet>
            Say &ldquo;I don&rsquo;t know&rdquo; when you don&rsquo;t. Delivery never changes that.
          </Quiet>
        </div>
        {submitError !== null && (
          <div className="mt-3">
            <Failed error={submitError} />
          </div>
        )}
      </Panel>

      {notes.length > 0 && (
        <Panel title="Notices">
          <ul className="space-y-1 text-sm text-quiet">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </Panel>
      )}

      {result !== null && (
        <Panel
          title="Recorded"
          subtitle="Observations only — the numbers behind them live in the debrief."
        >
          <div className="mb-3">
            <PerformanceDisclaimer />
          </div>
          <div className="flex flex-wrap gap-2">
            {result.prosody !== null && (
              <>
                <Tag>{result.prosody.words.length} words</Tag>
                <Tag>{result.prosody.pauses.length} pauses</Tag>
                <Tag>{result.prosody.pitch.medianHz.toFixed(0)} Hz median pitch</Tag>
              </>
            )}
            {result.kinematics !== null && (
              <>
                <Tag>face visible {result.kinematics.faceVisibleRatio.toFixed(2)}</Tag>
                <Tag>facing the lens {result.kinematics.gazeOnCameraRatio.toFixed(2)}</Tag>
                <Tag>{result.kinematics.gesture.ratePerMinute.toFixed(1)} gestures/min</Tag>
              </>
            )}
            {result.prosody === null && result.kinematics === null && (
              <Quiet>Answer recorded as text only.</Quiet>
            )}
          </div>
          <p className="mt-3 text-sm">
            <Link
              to={`/debrief?id=${sessionId}`}
              className="text-accent underline underline-offset-2"
            >
              Open the debrief
            </Link>{' '}
            to see both lanes for this session.
          </p>
        </Panel>
      )}
    </div>
  )
}
