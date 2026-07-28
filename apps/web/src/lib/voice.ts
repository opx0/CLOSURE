export const VOICE_URL_KEY = 'closer.voiceUrl'
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

export async function speak(text: string): Promise<void> {
  const response = await fetch(`${voiceUrl()}/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!response.ok) throw new Error(`the voice service answered ${response.status}`)
  const audio = new Audio(URL.createObjectURL(await response.blob()))
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve()
    void audio.play().catch(() => resolve())
  })
}
