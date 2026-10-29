export const VOICE_URL_KEY = 'levelhead.voiceUrl'
export const DEFAULT_VOICE_URL = 'http://localhost:8091'

export function voiceUrl(): string {
  try {
    return localStorage.getItem(VOICE_URL_KEY) ?? DEFAULT_VOICE_URL
  } catch {
    return DEFAULT_VOICE_URL
  }
}

export interface SpokenAnswer {
  transcript: string
  audioMs: number
  pauses: { atMs: number; durationMs: number }[]
}

const SILENCE_THRESHOLD = 0.012
const FRAME_MS = 50

// Pace, pauses and filler words are the only things voice contributes, and they are measured here,
// in the browser, from the recording itself. Nothing about delivery reaches the Evaluator: it
// receives the same answer string a typed answer produces.
export async function measurePauses(
  blob: Blob,
): Promise<{ audioMs: number; pauses: SpokenAnswer['pauses'] }> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = decoded.getChannelData(0)
    const perFrame = Math.max(1, Math.round((decoded.sampleRate * FRAME_MS) / 1_000))

    const pauses: SpokenAnswer['pauses'] = []
    let quietFrom: number | null = null
    for (let frame = 0; frame * perFrame < samples.length; frame += 1) {
      let peak = 0
      for (
        let at = frame * perFrame;
        at < Math.min((frame + 1) * perFrame, samples.length);
        at += 1
      ) {
        peak = Math.max(peak, Math.abs(samples[at] ?? 0))
      }
      const atMs = frame * FRAME_MS
      if (peak < SILENCE_THRESHOLD) {
        quietFrom ??= atMs
      } else if (quietFrom !== null) {
        pauses.push({ atMs: quietFrom, durationMs: atMs - quietFrom })
        quietFrom = null
      }
    }

    const audioMs = Math.round(decoded.duration * 1_000)
    if (quietFrom !== null) pauses.push({ atMs: quietFrom, durationMs: audioMs - quietFrom })
    return { audioMs, pauses }
  } finally {
    await context.close()
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const response = await fetch(`${voiceUrl()}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': blob.type },
    body: blob,
  })
  if (!response.ok) throw new Error(`the voice service answered ${response.status}`)
  return ((await response.json()) as { text: string }).text
}

interface SpeechPlayback {
  controller: AbortController
  audio: HTMLAudioElement | null
  url: string | null
}

let currentSpeech: SpeechPlayback | null = null

export function cancelSpeech(): void {
  const playing = currentSpeech
  currentSpeech = null
  if (playing === null) return
  playing.controller.abort()
  playing.audio?.pause()
  if (playing.url !== null) URL.revokeObjectURL(playing.url)
}

export function speechPhrases(text: string): string[] {
  const phrases: string[] = []
  let start = 0
  for (const match of text.matchAll(/[.!?]+(?=\s|$)/g)) {
    const end = match.index + match[0].length
    const phrase = text.slice(start, end).trim()
    if (phrase) phrases.push(phrase)
    start = end
  }
  const tail = text.slice(start).trim()
  if (tail) phrases.push(tail)
  return phrases
}

// One phrase plays while the next is synthesized. A new question cancels both its old audio and
// the pending fetch, so a late TTS response cannot speak over the current prompt.
export async function speak(text: string): Promise<void> {
  cancelSpeech()
  const phrases = speechPhrases(text)
  if (phrases.length === 0) return
  const playback: SpeechPlayback = { controller: new AbortController(), audio: null, url: null }
  currentSpeech = playback
  const load = (phrase: string) =>
    fetch(`${voiceUrl()}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: phrase }),
      signal: playback.controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`the voice service answered ${response.status}`)
      return response.blob()
    })
  // A prefetched phrase must settle without an unhandled rejection while the previous phrase plays.
  const settled = (phrase: string) =>
    load(phrase).then(
      (blob) => ({ blob, error: null }),
      (error: unknown) => ({ blob: null, error }),
    )
  let next = settled(phrases[0]!)
  try {
    for (let index = 0; index < phrases.length; index += 1) {
      const result = await next
      if (playback.controller.signal.aborted) return
      if (result.error !== null || result.blob === null) throw result.error
      if (index + 1 < phrases.length) next = settled(phrases[index + 1]!)
      const url = URL.createObjectURL(result.blob)
      const audio = new Audio(url)
      playback.audio = audio
      playback.url = url
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('speech playback failed'))
        playback.controller.signal.addEventListener('abort', () => resolve(), { once: true })
        void audio.play().catch(reject)
      })
      URL.revokeObjectURL(url)
      playback.url = null
      playback.audio = null
      if (playback.controller.signal.aborted) return
    }
  } finally {
    if (currentSpeech === playback) currentSpeech = null
    playback.controller.abort()
    playback.audio?.pause()
    if (playback.url !== null) URL.revokeObjectURL(playback.url)
  }
}
