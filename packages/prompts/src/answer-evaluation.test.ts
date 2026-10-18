import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { ROUND_ORDER, type RoundKind } from '@levelhead/contracts'
import { answerEvaluationPrompt, type AnswerEvaluationVars } from './answer-evaluation.ts'

const topic = {
  area: 'dsa',
  title: 'Finding a duplicate',
  ask: 'How would you find the one duplicate in an array of a billion integers?',
} as const

const artifact = {
  path: 'src/queue.ts',
  symbol: 'claimJob',
  startLine: 42,
  endLine: 61,
  code: 'export async function claimJob(db: Db) {\n  // lease for 30 seconds\n}',
}

function fencedSpans(text: string): string[] {
  return [...text.matchAll(/(<<<UNTRUSTED_[A-Z]+>>>)\n([\s\S]*?)\n\1/g)].map(
    (match) => match[2] ?? '',
  )
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
  const focusMarkers: Record<RoundKind, string> = {
    cs_fundamentals: 'A term named without its mechanism is a term, not an explanation',
    problem_solving: 'Never judge code syntax, naming or language details',
    role_knowledge: 'Naming a tool is not knowing it',
    system_design: 'actually reasoned, each choice given a reason and a cost, rather than listed',
    behavioral: 'Ownership and cost are what is judged',
    project_deep_dive: 'the layer below the résumé sentence',
    design_extension: 'whether the design actually changed under the new constraint',
    code_walkthrough: 'Where the answer contradicts the code',
  }
  const briefs = ROUND_ORDER.map((round) => answerEvaluationPrompt.render(varsFor(round)).user)
  expect(new Set(briefs).size).toBe(ROUND_ORDER.length)

  ROUND_ORDER.forEach((round, index) => expect(briefs[index]).toContain(focusMarkers[round]))
})

test('problem solving is judged on the reasoning about approach, complexity and edge cases', () => {
  const { user } = answerEvaluationPrompt.render(varsFor('problem_solving', { claim: null, topic }))
  expect(user).toContain('whether its time and space complexity is stated and right')
  expect(user).toContain('which edge cases and breaking inputs they name')
})

test('the honesty contract is the same six clauses in every round, with or without code, claim or topic', () => {
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
    expect(answerEvaluationPrompt.render(varsFor(round, { claim: null, topic })).system).toBe(
      baseline,
    )
  }
})

test('abstention names the finding kind that fits whether or not a claim is on the table', () => {
  const { system } = answerEvaluationPrompt.render(varsFor('cs_fundamentals'))
  expect(system).toContain(
    'When a claim is supplied below, the abstention is a claim_abstained finding carrying that abstention.',
  )
  expect(system).toContain(
    'When no claim is supplied, it is a competency_abstained finding carrying that abstention and the competency you cannot judge: mechanism, trade_offs or failure_modes.',
  )

  const withClaim = answerEvaluationPrompt.render(varsFor('project_deep_dive')).user
  expect(fencedSpans(withClaim)).toContain('Built a durable job queue on PostgreSQL.')
  expect(withClaim).not.toContain('competency_abstained')

  const withoutClaim = answerEvaluationPrompt.render(
    varsFor('cs_fundamentals', { claim: null, topic }),
  ).user
  expect(withoutClaim).toContain('return no claim or claim_abstained finding')
  expect(withoutClaim).toContain(
    'Where the answer does not let you judge a competency, return competency_abstained for it.',
  )
  expect(withoutClaim).not.toContain('<<<UNTRUSTED_CLAIM>>>')
})

test('the topic names what was asked, in the clear rather than fenced as candidate data', () => {
  const { user } = answerEvaluationPrompt.render(varsFor('problem_solving', { claim: null, topic }))
  expect(user).toContain(
    'The topic the interviewer chose for this turn: Finding a duplicate (dsa).',
  )
  expect(user).toContain(
    'The question it opened on: How would you find the one duplicate in an array of a billion integers?',
  )
  for (const fenced of fencedSpans(user)) {
    expect(fenced).not.toContain('Finding a duplicate')
    expect(fenced).not.toContain('How would you find the one duplicate')
  }

  const untopical = answerEvaluationPrompt.render(varsFor('project_deep_dive')).user
  expect(untopical).not.toContain('The topic the interviewer chose')
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
  expect(answerEvaluationPrompt.version).toBe(3)
})
