import { useRef, useState } from 'react'
import { measurePauses, transcribe, type SpokenAnswer } from '../lib/voice.ts'
import { Button, Quiet } from './primitives.tsx'

// Fails soft, deliberately: the text is what the Evaluator uses, so a voice service that is not
// running costs the speaking and nothing else.
export function Recorder({ onAnswer }: { onAnswer: (spoken: SpokenAnswer) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const start = async () => {
    setProblem(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks.current = []
      const media = new MediaRecorder(stream)
      media.ondataavailable = (event) => chunks.current.push(event.data)
      media.start()
      recorder.current = media
      setState('recording')
    } catch (error) {
      setProblem(`no microphone: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const stop = async () => {
    const media = recorder.current
    if (media === null) return
    setState('working')
    await new Promise<void>((resolve) => {
      media.onstop = () => resolve()
      media.stop()
      media.stream.getTracks().forEach((track) => track.stop())
    })

    const blob = new Blob(chunks.current, { type: media.mimeType })
    try {
      const [transcript, timing] = await Promise.all([transcribe(blob), measurePauses(blob)])
      onAnswer({ transcript, audioMs: timing.audioMs, pauses: timing.pauses })
    } catch (error) {
      setProblem(
        `${error instanceof Error ? error.message : String(error)} — is \`bun run voice:up\` running? Continuing in text.`,
      )
    } finally {
      setState('idle')
      recorder.current = null
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {state === 'recording' ? (
          <Button tone="danger" onClick={() => void stop()}>
            ⏹ Stop recording
          </Button>
        ) : (
          <Button onClick={() => void start()} disabled={state === 'working'}>
            {state === 'working' ? 'transcribing…' : '🎙 Speak your answer'}
          </Button>
        )}
        <Quiet>
          Check the transcript says what you actually said — the evaluator can only cite words that
          appear in it.
        </Quiet>
      </div>
      {problem !== null && <p className="mt-2 text-xs text-broken">{problem}</p>}
    </div>
  )
}
