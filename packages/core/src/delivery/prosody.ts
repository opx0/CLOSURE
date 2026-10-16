import { DISCOURSE_MARKERS, FILLER_WORDS, PERFORMANCE_BOUNDARY } from '@levelhead/contracts'
import type {
  DisfluencyCounts,
  IntensityTrack,
  PitchTrack,
  ProsodyReport,
  TimedPause,
  TimedWord,
} from '@levelhead/contracts'

// A gap shorter than this is articulation between two words, not a silence a listener hears.
export const PAUSE_MS = 250

// Hesitations landing this close together are heard as one stumble rather than as separate events.
export const HESITATION_WINDOW_MS = 3_000

// A stretched word is measured against the same speaker's own median, never against a norm.
export const PROLONGATION_MULTIPLE = 3

const PROLONGATION_MAX_CHARS = 4
const RESTART_LOOKAHEAD = 4
const COORDINATING_CONJUNCTIONS = ['and', 'but', 'or', 'nor', 'for', 'yet', 'so']
const REPAIR_MARKERS = ['i mean', 'sorry']
const CLAUSE_END = /[.,;:!?]$/

export interface MeasuredSentence {
  readonly words: number
  readonly endsRising: boolean
}

export interface ProsodyMeasurement {
  readonly audioMs: number
  readonly words: readonly TimedWord[]
  readonly sentences: readonly MeasuredSentence[]
  readonly pitch: Omit<PitchTrack, 'declarativesCounted' | 'declarativesEndingRising'>
  readonly intensity: IntensityTrack
}

export interface ProsodyInput {
  readonly attemptId: string
  readonly measurement: ProsodyMeasurement
  readonly questionEndedAtMs?: number | undefined
}

interface AnnotatedWord {
  readonly word: TimedWord
  readonly token: string
  readonly isFiller: boolean
  readonly isMarker: boolean
  readonly endsClause: boolean
  readonly isConjunction: boolean
}

interface DisfluencyEvent {
  readonly kind: 'repair' | 'restart' | 'prolongation'
  readonly atMs: number
}

interface PhraseMatches {
  readonly covered: readonly boolean[]
  readonly starts: readonly number[]
}

interface DeclarativeCounts {
  readonly counted: number
  readonly endingRising: number
}

function positiveMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function positiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function tokenOf(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

// The sidecar is a separate process, so this is the one place its numbers are trusted, and the
// schema downstream requires non-negative integers.
function normaliseWords(words: readonly TimedWord[]): TimedWord[] {
  return words
    .filter((word) => word.text.trim() !== '')
    .map((word) => ({
      text: word.text,
      startMs: positiveMs(word.startMs),
      endMs: positiveMs(word.endMs),
    }))
}

// Longest match first, so `you know` is one filler and not two words that happen to be adjacent.
function matchPhrases(tokens: readonly string[], phrases: readonly string[]): PhraseMatches {
  const ordered = phrases.map((phrase) => phrase.split(' ')).sort((a, b) => b.length - a.length)
  const covered = tokens.map(() => false)
  const starts: number[] = []

  for (let at = 0; at < tokens.length;) {
    const hit = ordered.find((parts) => parts.every((part, offset) => tokens[at + offset] === part))
    if (hit === undefined) {
      at += 1
      continue
    }
    for (let offset = 0; offset < hit.length; offset += 1) covered[at + offset] = true
    starts.push(at)
    at += hit.length
  }

  return { covered, starts }
}

function annotate(
  words: readonly TimedWord[],
  tokens: readonly string[],
  fillers: PhraseMatches,
  markers: PhraseMatches,
): AnnotatedWord[] {
  return words.map((word, at) => {
    const token = tokens[at] ?? ''
    return {
      word,
      token,
      // The two lists overlap and a word can be both. They are independent counts, not one count.
      isFiller: fillers.covered[at] === true,
      isMarker: markers.covered[at] === true,
      endsClause: CLAUSE_END.test(word.text.trimEnd()),
      isConjunction: COORDINATING_CONJUNCTIONS.includes(token),
    }
  })
}

// Position is decided lexically, from punctuation and conjunctions in the transcript. It is never a
// claim about why the speaker paused.
function findPauses(words: readonly AnnotatedWord[]): TimedPause[] {
  const pauses: TimedPause[] = []
  let previous: AnnotatedWord | undefined
  let filledSincePrevious = false

  for (const word of words) {
    if (word.isFiller) {
      filledSincePrevious = true
      continue
    }
    if (previous !== undefined) {
      // The whole interval between two content words. A filler sitting inside it is part of the
      // pause a listener hears, not a word that shortens it.
      const durationMs = word.word.startMs - previous.word.endMs
      if (durationMs >= PAUSE_MS) {
        pauses.push({
          atMs: previous.word.endMs,
          durationMs,
          kind: filledSincePrevious ? 'filled' : 'unfilled',
          position:
            previous.endsClause || previous.isConjunction ? 'clause_boundary' : 'mid_clause',
        })
      }
    }
    previous = word
    filledSincePrevious = false
  }

  return pauses
}

function medianDuration(words: readonly AnnotatedWord[]): number {
  const durations = words
    .map((word) => word.word.endMs - word.word.startMs)
    .filter((duration) => duration > 0)
    .sort((a, b) => a - b)
  if (durations.length === 0) return 0

  const middle = Math.floor(durations.length / 2)
  if (durations.length % 2 === 1) return durations[middle] ?? 0
  return ((durations[middle - 1] ?? 0) + (durations[middle] ?? 0)) / 2
}

function findRestarts(words: readonly AnnotatedWord[]): DisfluencyEvent[] {
  const restarts: DisfluencyEvent[] = []

  for (let at = 0; at < words.length;) {
    const start = words[at]
    const clauseInitial = at === 0 || words[at - 1]?.endsClause === true
    if (start === undefined || !clauseInitial || start.endsClause) {
      at += 1
      continue
    }

    let resumeAt = at + 1
    for (let ahead = at + 2; ahead <= at + RESTART_LOOKAHEAD && ahead < words.length; ahead += 1) {
      const before = words[ahead - 1]
      if (before === undefined || before.endsClause || before.isConjunction) break
      const candidate = words[ahead]
      if (candidate !== undefined && candidate.token !== '' && candidate.token === start.token) {
        restarts.push({ kind: 'restart', atMs: candidate.word.startMs })
        resumeAt = ahead
        break
      }
    }
    at = resumeAt
  }

  return restarts
}

// One timeline read several ways. The counts below and the hesitation clusters come off this list.
function findDisfluencyEvents(
  words: readonly AnnotatedWord[],
  tokens: readonly string[],
): DisfluencyEvent[] {
  const events: DisfluencyEvent[] = []

  for (let at = 1; at < words.length; at += 1) {
    const current = words[at]
    const previous = words[at - 1]
    if (current === undefined || previous === undefined) continue
    if (current.token !== '' && current.token === previous.token) {
      events.push({ kind: 'repair', atMs: current.word.startMs })
    }
  }

  for (const start of matchPhrases(tokens, REPAIR_MARKERS).starts) {
    const word = words[start]
    if (word !== undefined) events.push({ kind: 'repair', atMs: word.word.startMs })
  }

  // The multiple is self-relative on purpose. No published duration for a normal word exists, and
  // the speaker's own median is the only denominator that is not invented.
  const median = medianDuration(words)
  if (median > 0) {
    for (const word of words) {
      const duration = word.word.endMs - word.word.startMs
      const short = word.token.length <= PROLONGATION_MAX_CHARS
      if (short && duration >= median * PROLONGATION_MULTIPLE) {
        events.push({ kind: 'prolongation', atMs: word.word.startMs })
      }
    }
  }

  events.push(...findRestarts(words))
  return events
}

function countDisfluencies(
  events: readonly DisfluencyEvent[],
  discourseMarkers: number,
): DisfluencyCounts {
  return {
    repairs: events.filter((event) => event.kind === 'repair').length,
    restarts: events.filter((event) => event.kind === 'restart').length,
    prolongations: events.filter((event) => event.kind === 'prolongation').length,
    discourseMarkers,
  }
}

// A hesitation event is a filled pause, a repair or a prolongation. A restart is counted as a
// disfluency but not here, so a cluster stays the thing the contract names and not a second total.
function clusterHesitations(
  pauses: readonly TimedPause[],
  events: readonly DisfluencyEvent[],
): ProsodyReport['hesitationClusters'] {
  const times = [
    ...pauses.filter((pause) => pause.kind === 'filled').map((pause) => pause.atMs),
    ...events.filter((event) => event.kind !== 'restart').map((event) => event.atMs),
  ].sort((a, b) => a - b)

  const clusters: ProsodyReport['hesitationClusters'] = []
  for (let at = 0; at < times.length;) {
    const start = times[at] ?? 0
    let last = at
    while (last + 1 < times.length && (times[last + 1] ?? 0) <= start + HESITATION_WINDOW_MS) {
      last += 1
    }
    const grouped = last - at + 1
    if (grouped >= 2) {
      clusters.push({ atMs: start, durationMs: (times[last] ?? start) - start, events: grouped })
    }
    at = last + 1
  }

  return clusters
}

function countDeclaratives(
  words: readonly TimedWord[],
  sentences: readonly MeasuredSentence[],
): DeclarativeCounts {
  let cursor = 0
  let counted = 0
  let endingRising = 0

  for (const sentence of sentences) {
    if (sentence.words <= 0) continue
    const last = words[cursor + sentence.words - 1]
    cursor += sentence.words
    // A question ending high is its grammar, so it is not a statement that rose.
    if (last === undefined || last.text.trimEnd().endsWith('?')) continue
    counted += 1
    if (sentence.endsRising) endingRising += 1
  }

  return { counted, endingRising }
}

export function buildProsodyReport(input: ProsodyInput): ProsodyReport {
  const { measurement } = input
  const words = normaliseWords(measurement.words)
  const tokens = words.map((word) => tokenOf(word.text))
  const markers = matchPhrases(tokens, DISCOURSE_MARKERS)
  const annotated = annotate(words, tokens, matchPhrases(tokens, FILLER_WORDS), markers)

  const pauses = findPauses(annotated)
  const events = findDisfluencyEvents(annotated, tokens)
  const declaratives = countDeclaratives(words, measurement.sentences)
  const firstWord = words[0]
  const firstContent = annotated.find(
    (word) => !word.isFiller && !word.isMarker && word.token !== '',
  )

  return {
    attemptId: input.attemptId,
    audioMs: positiveMs(measurement.audioMs),
    words,
    pauses,
    hesitationClusters: clusterHesitations(pauses, events),
    disfluencies: countDisfluencies(events, markers.starts.length),
    pitch: {
      // The sidecar reports a non-number where nothing was voiced, and the schema forbids negatives.
      medianHz: positiveNumber(measurement.pitch.medianHz),
      p10Hz: positiveNumber(measurement.pitch.p10Hz),
      p90Hz: positiveNumber(measurement.pitch.p90Hz),
      rangeSemitones: positiveNumber(measurement.pitch.rangeSemitones),
      coefficientOfVariation: positiveNumber(measurement.pitch.coefficientOfVariation),
      declarativesCounted: declaratives.counted,
      declarativesEndingRising: declaratives.endingRising,
    },
    intensity: {
      // Decibel values here are legitimately negative, so only a non-number is clamped.
      medianDb: finiteNumber(measurement.intensity.medianDb),
      endOfTurnDropDb: finiteNumber(measurement.intensity.endOfTurnDropDb),
    },
    // `questionEndedAtMs` is on the same clock as the word timings: the caller that watches the
    // question finish is the caller that starts the recording.
    responseLatencyMs:
      input.questionEndedAtMs === undefined || firstWord === undefined
        ? null
        : Math.max(0, firstWord.startMs - input.questionEndedAtMs),
    timeToFirstContentWordMs: firstContent?.word.startMs ?? null,
    sentenceLengthsWords: measurement.sentences.map((sentence) =>
      Math.max(0, Math.round(sentence.words)),
    ),
    boundary: PERFORMANCE_BOUNDARY,
  }
}

function millis(value: number | null): string {
  return value === null ? '-' : `${value} ms`
}

export function renderProsody(report: ProsodyReport): string[] {
  const filled = report.pauses.filter((pause) => pause.kind === 'filled').length
  const midClause = report.pauses.filter((pause) => pause.position === 'mid_clause').length
  const clusters = report.hesitationClusters.length
  const stacked = report.hesitationClusters.reduce((total, cluster) => total + cluster.events, 0)
  const counts = report.disfluencies
  const pitch = report.pitch

  return [
    `  pauses          ${report.pauses.length} · ${filled} filled, ${report.pauses.length - filled} silent · ${midClause} mid-clause`,
    `  hesitation      ${clusters} cluster${clusters === 1 ? '' : 's'} · ${stacked} stacked events`,
    `  disfluencies    repairs ${counts.repairs} · restarts ${counts.restarts} · prolongations ${counts.prolongations} · discourse markers ${counts.discourseMarkers}`,
    `  pitch           ${pitch.medianHz.toFixed(0)} Hz median · ${pitch.rangeSemitones.toFixed(1)} semitones · variation ${pitch.coefficientOfVariation.toFixed(2)}`,
    `  terminal rise   ${pitch.declarativesEndingRising}/${pitch.declarativesCounted} statements`,
    `  loudness        ${report.intensity.medianDb.toFixed(1)} dB median · ${report.intensity.endOfTurnDropDb.toFixed(1)} dB at end of turn`,
    `  onset           ${millis(report.responseLatencyMs)} to first word · ${millis(report.timeToFirstContentWordMs)} to first content word`,
    '  These are observations about delivery. They say nothing about whether the answer was any',
    '  good, they are never part of a finding, and they never reach the gap ledger.',
  ]
}
