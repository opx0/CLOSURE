import { expect, test } from 'bun:test'
import { REDACTED, isContentBearing, isSecretBearing, redactFields } from './redact.ts'

// PROJECT.md promises redacted logs. A log line that quietly contains a résumé breaks that promise
// directly, so redaction happens by field name at the boundary rather than by a caller remembering.
test('anything that could carry candidate content is redacted by name', () => {
  const safe = redactFields({
    sessionId: 'ses_1',
    answerText: 'we leased each job for thirty seconds',
    resumeText: 'Built a durable job queue',
    transcript: 'interviewer: ...',
    rationale: 'lease recovery is described',
    quoted: 'I do not think we handled that',
  })

  expect(safe['sessionId']).toBe('ses_1')
  for (const key of ['answerText', 'resumeText', 'transcript', 'rationale', 'quoted']) {
    expect(safe[key]).toBe(REDACTED)
  }
})

test('secrets are redacted whatever case or punctuation the field name uses', () => {
  const safe = redactFields({
    MODEL_PROVIDER_API_KEY: 'sk-real-key',
    'x-api-token': 'abc',
    databaseUrl: 'postgres://user:pass@host/db',
  })

  expect(Object.values(safe)).toEqual([REDACTED, REDACTED, REDACTED])
  expect(isSecretBearing('Authorization')).toBe(true)
  expect(isContentBearing('questionText')).toBe(true)
})

test('a long string is redacted even under a field name nobody anticipated', () => {
  const safe = redactFields({ note: 'x'.repeat(257), shortNote: 'fine' })

  expect(safe['note']).toBe(REDACTED)
  expect(safe['shortNote']).toBe('fine')
})

test('an undefined field is dropped rather than logged as the string undefined', () => {
  expect(redactFields({ present: 1, missing: undefined })).toEqual({ present: 1 })
})
