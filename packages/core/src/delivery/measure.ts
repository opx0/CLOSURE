import { DELIVERY_BOUNDARY, FILLER_WORDS } from '@closer/contracts'
import type { DeliveryReport, SpokenTurn } from '@closer/contracts'

export const LONG_PAUSE_MS = 1_500

function words(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
}

function countPhrase(haystack: string[], phrase: string): number {
  const parts = phrase.split(' ')
  if (parts.length === 1) return haystack.filter((word) => word === phrase).length
  let found = 0
  for (let at = 0; at + parts.length <= haystack.length; at += 1) {
    if (parts.every((part, offset) => haystack[at + offset] === part)) found += 1
  }
  return found
}

export function measureDelivery(turn: SpokenTurn): DeliveryReport {
  const spoken = words(turn.transcript)
  const spokenSeconds = turn.audioMs / 1_000
  const longPauses = turn.pauses.filter((pause) => pause.durationMs >= LONG_PAUSE_MS)

  const fillerCounts: Record<string, number> = {}
  let fillerTotal = 0
  for (const filler of FILLER_WORDS) {
    const count = countPhrase(spoken, filler)
    if (count > 0) {
      fillerCounts[filler] = count
      fillerTotal += count
    }
  }

  return {
    attemptId: turn.attemptId,
    wordsPerMinute: spokenSeconds > 0 ? (spoken.length / spokenSeconds) * 60 : 0,
    spokenSeconds,
    wordCount: spoken.length,
    longPauseCount: longPauses.length,
    longestPauseMs: longPauses.reduce((longest, pause) => Math.max(longest, pause.durationMs), 0),
    fillerCounts,
    fillerRatePerHundredWords: spoken.length > 0 ? (fillerTotal / spoken.length) * 100 : 0,
    boundary: DELIVERY_BOUNDARY,
  }
}

export function renderDelivery(report: DeliveryReport): string[] {
  const fillers = Object.entries(report.fillerCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([word, count]) => `${word}×${count}`)
    .join(', ')

  return [
    `  pace            ${report.wordsPerMinute.toFixed(0)} words/min over ${report.spokenSeconds.toFixed(1)}s`,
    `  long pauses     ${report.longPauseCount}${report.longestPauseMs > 0 ? ` (longest ${(report.longestPauseMs / 1000).toFixed(1)}s)` : ''}`,
    `  filler words    ${fillers === '' ? 'none detected' : fillers} · ${report.fillerRatePerHundredWords.toFixed(1)} per 100 words`,
    '  These are observations about delivery. They say nothing about whether the answer was any',
    '  good, they are never part of a finding, and they never reach the gap ledger.',
  ]
}
