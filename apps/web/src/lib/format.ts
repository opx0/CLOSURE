export function words(value: string): string {
  return value.replace(/_/g, ' ')
}

export function day(iso: string): string {
  return iso === '' ? '—' : iso.slice(0, 10)
}

// §4.4: a confidence is stated, never rounded into a verdict. Both forms are shown together so the
// word can never be mistaken for the number.
export function confidenceWord(confidence: number): string {
  if (confidence >= 0.75) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}

export function usd(value: number): string {
  return `$${value.toFixed(4)}`
}
