export const CONTENT_BEARING_KEYS: readonly string[] = [
  'answer',
  'assertion',
  'body',
  'code',
  'content',
  'excerpt',
  'question',
  'quote',
  'quoted',
  'rationale',
  'resume',
  'resumetext',
  'snippet',
  'summary',
  'text',
  'transcript',
]

export const SECRET_BEARING_KEYS: readonly string[] = [
  'apikey',
  'authorization',
  'cookie',
  'databaseurl',
  'password',
  'secret',
  'token',
]

export const REDACTED = '[redacted]'

function normalise(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '')
}

export function isContentBearing(key: string): boolean {
  const flat = normalise(key)
  return CONTENT_BEARING_KEYS.some((candidate) => flat.includes(candidate))
}

export function isSecretBearing(key: string): boolean {
  const flat = normalise(key)
  return SECRET_BEARING_KEYS.some((candidate) => flat.includes(candidate))
}

export type Scalar = string | number | boolean | null | undefined

// A log line that quietly contains a résumé breaks the export/deletion promise directly
// (STACK §15), so redaction happens at the field boundary and never depends on a caller
// remembering. Opaque ids pass through; anything that could carry candidate text does not.
export function redactFields(fields: Record<string, Scalar>): Record<string, Scalar> {
  const safe: Record<string, Scalar> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (isSecretBearing(key) || isContentBearing(key)) {
      safe[key] = REDACTED
      continue
    }
    safe[key] = typeof value === 'string' && value.length > 256 ? REDACTED : value
  }
  return safe
}
