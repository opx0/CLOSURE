import { useEffect, useRef, useState } from 'react'
import { startLiveSpeech, type LiveSpeech } from '../lib/live-speech.ts'
import { Button, Quiet } from './primitives.tsx'

export function LiveRecorder({
  sessionId,
  onAnswer,
}: {
  sessionId: string
  onAnswer: (text: string) => void
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'paused' | 'finishing'>(
    'idle',
  )
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [connection, setConnection] = useState('')
  const active = useRef<LiveSpeech | null>(null)
  const abandoned = useRef(false)
  const latestDraft = useRef('')

  useEffect(() => {
    abandoned.current = false
    return () => {
      abandoned.current = true
      active.current?.stop()
      active.current = null
    }
  }, [sessionId])

  const start = async () => {
    setProblem(null)
    setConnection('')
    setDraft('')
    latestDraft.current = ''
    setState('starting')
    let handled = false
    try {
      const recorder = await startLiveSpeech(
        sessionId,
        (text, final) => {
          if (abandoned.current) return
          latestDraft.current = text
          setDraft(text)
          if (final) {
            active.current = null
            setState('idle')
            onAnswer(text)
          }
        },
        (message) => {
          if (!abandoned.current) {
            handled = true
            if (latestDraft.current) onAnswer(latestDraft.current)
            setProblem(message)
            setState('idle')
            active.current = null
          }
        },
        (message) => {
          if (!abandoned.current) setConnection(message)
        },
      )
      if (abandoned.current) recorder.stop()
      else {
        active.current = recorder
        setState('recording')
      }
    } catch (error) {
      if (!abandoned.current && !handled) {
        setProblem(
          `${error instanceof Error ? error.message : String(error)}. Continue in text or use batch transcription.`,
        )
        setState('idle')
      }
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'idle' ? (
          <Button onClick={() => void start()}>Start live speech</Button>
        ) : state === 'starting' ? (
          <Button disabled>Connecting microphone…</Button>
        ) : state === 'finishing' ? (
          <Button disabled>Finalizing transcript…</Button>
        ) : (
          <>
            <Button
              onClick={() => {
                if (state === 'paused') {
                  active.current?.resume()
                  setState('recording')
                } else {
                  active.current?.pause()
                  setState('paused')
                }
              }}
            >
              {state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button
              onClick={() => {
                active.current?.done()
                setState('finishing')
              }}
            >
              Done speaking
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                active.current?.stop()
                active.current = null
                setState('idle')
              }}
            >
              Stop without submitting
            </Button>
          </>
        )}
        <Quiet>
          Final text fills the answer box; on failure, captured partial text stays editable. Review
          before sending.
        </Quiet>
      </div>
      {draft && (
        <p className="text-xs text-muted" aria-live="polite">
          Live text: {draft}
        </p>
      )}
      {connection && <p role="status">{connection}</p>}
      {problem && (
        <p className="text-xs text-broken" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
