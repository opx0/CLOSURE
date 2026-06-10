import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { ROUND_ORDER, type RoundKind } from '@closer/contracts'
import { answerEvaluationPrompt, type AnswerEvaluationVars } from './answer-evaluation.ts'

const artifact = {
  path: 'src/queue.ts',
  symbol: 'claimJob',
  startLine: 42,
  endLine: 61,
  code: 'export async function claimJob(db: Db) {\n  // lease for 30 seconds\n}',
}

function varsFor(round: RoundKind, overrides: Partial<AnswerEvaluationVars> = {}) {
  return {
    level: 'senior',
    action: 'PROBE_MECHANISM',
    round,
    claim: { type: 'built', assertion: 'Built a durable job queue on PostgreSQL.' },
    anchors: [
      {
        rubricId: 'mechanism',
        rubricVersion: 1,
        expectation: 'Describes how the thing works, unprompted.',
        requiredConcepts: ['lease expiry', 'idempotent completion'],
      },
    ],
    transcript: [{ role: 'interviewer', text: 'How does it recover?' }],
    answerText: 'The lease expires after thirty seconds and another worker picks the job up.',
    ...overrides,
  } satisfies AnswerEvaluationVars
}

test('each round tells the Evaluator what that round put on trial', () => {
  const briefs = ROUND_ORDER.map((round) => answerEvaluationPrompt.render(varsFor(round)).user)
  expect(new Set(briefs).size).toBe(ROUND_ORDER.length)

  const [deepDive, design, behavioral, walkthrough] = briefs as [string, string, string, string]
  expect(deepDive).toContain('the layer below the résumé sentence')
  expect(design).toContain('whether the design actually changed under the new constraint')
  expect(design).toContain('restated with the new number appended')
  expect(behavioral).toContain('Ownership and cost are what is judged')
  expect(behavioral).toContain('not queue mechanics and not system design')
  expect(walkthrough).toContain('Where the answer contradicts the code')
})

test('the honesty contract is the same six clauses in every round, with or without code', () => {
  const clauses = [
    '1. CITE.',
    '2. ABSTAIN RATHER THAN GUESS.',
    '3. NEVER INVENT.',
    '4. JUDGE AGAINST THE ANCHOR SUPPLIED.',
    '5. COMPOSURE IS SEPARATE FROM CORRECTNESS.',
    '6. CONFIDENCE IS CALIBRATED.',
  ]
  const baseline = answerEvaluationPrompt.render(varsFor('project_deep_dive')).system
  for (const clause of clauses) expect(baseline).toContain(clause)

  for (const round of ROUND_ORDER) {
    expect(answerEvaluationPrompt.render(varsFor(round)).system).toBe(baseline)
    expect(answerEvaluationPrompt.render(varsFor(round, { artifact })).system).toBe(baseline)
  }
})

test('composure stays tied to the pressure move, not to the round', () => {
  const pressed = answerEvaluationPrompt.render(varsFor('behavioral', { action: 'FALSE_PREMISE' }))
  expect(pressed.user).toContain('a pressure move, so composure is on the table this turn')

  const plain = answerEvaluationPrompt.render(varsFor('behavioral'))
  expect(plain.user).toContain('do not return a composure finding this turn')
})

test('the code a walkthrough is judged against arrives fenced, and is never quotable', () => {
  const { user } = answerEvaluationPrompt.render(varsFor('code_walkthrough', { artifact }))
  const fence = '<<<UNTRUSTED_REPOSITORY>>>'
  const opened = user.indexOf(fence)
  const closed = user.indexOf(fence, opened + fence.length)
  expect(opened).toBeGreaterThan(-1)

  const fenced = user.slice(opened, closed)
  expect(fenced).toContain('FILE: src/queue.ts')
  expect(fenced).toContain('SYMBOL: claimJob')
  expect(fenced).toContain(artifact.code)
  expect(user).toContain('The quotes still come from the answer and only from the answer')
})

test('a walkthrough with no code judges the answer alone rather than a remembered file', () => {
  const { user } = answerEvaluationPrompt.render(varsFor('code_walkthrough'))
  expect(user).toContain('never assume what the file said')
  expect(user).not.toContain('<<<UNTRUSTED_REPOSITORY>>>')
})

test('the rendered prompt moves with the round; the prompt it is attributed by does not', () => {
  const digests = ROUND_ORDER.map((round) => {
    const { system, user } = answerEvaluationPrompt.render(varsFor(round))
    return createHash('sha256').update(`${system}\n${user}`).digest('hex')
  })
  expect(new Set(digests).size).toBe(ROUND_ORDER.length)
  expect(answerEvaluationPrompt.id).toBe('answer-evaluation')
  expect(answerEvaluationPrompt.version).toBe(1)
})
