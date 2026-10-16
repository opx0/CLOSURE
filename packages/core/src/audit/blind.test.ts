import { expect, test } from 'bun:test'
import type {
  ClaimAbstentionFinding,
  ClaimFinding,
  CompetencyAbstentionFinding,
  CompetencyFinding,
} from '@levelhead/contracts'
import { AUDIT_BOUNDARY, blindVariants, compareEvaluations } from './blind.ts'

const ANSWER =
  'We built the lease table at Ordinal Systems. Priya designed the retry path and she owned her own runbook.'

const IDENTITY = { names: ['Priya'], institutions: ['Ordinal Systems'] }

test('each rewrite names the one transform it applied, and the combined variant names all three', () => {
  expect(blindVariants(ANSWER, IDENTITY)).toEqual([
    {
      id: 'blind:personal_names_masked',
      transforms: ['personal_names_masked'],
      text: 'We built the lease table at Ordinal Systems. [NAME] designed the retry path and she owned her own runbook.',
    },
    {
      id: 'blind:institutions_masked',
      transforms: ['institutions_masked'],
      text: 'We built the lease table at [ORG]. Priya designed the retry path and she owned her own runbook.',
    },
    {
      id: 'blind:gendered_pronouns_neutralised',
      transforms: ['gendered_pronouns_neutralised'],
      text: 'We built the lease table at Ordinal Systems. Priya designed the retry path and they owned their own runbook.',
    },
    {
      id: 'blind:first_person_number_swapped',
      transforms: ['first_person_number_swapped'],
      text: 'I built the lease table at Ordinal Systems. Priya designed the retry path and she owned her own runbook.',
    },
    {
      id: 'blind:personal_names_masked+institutions_masked+gendered_pronouns_neutralised',
      transforms: ['personal_names_masked', 'institutions_masked', 'gendered_pronouns_neutralised'],
      text: 'We built the lease table at [ORG]. [NAME] designed the retry path and they owned their own runbook.',
    },
  ])
})

// A capitalised-token rule would mask PostgreSQL alongside Priya, and an audit that deletes the
// technical content of an answer measures its own damage instead of the Evaluator's behaviour.
test('nothing is masked that the caller did not name', () => {
  const variants = blindVariants('Priya and I shipped the PostgreSQL migration at Ordinal Systems.')

  expect(variants.map((variant) => variant.id)).toEqual(['blind:first_person_number_swapped'])
  expect(variants[0]?.text).toBe(
    'Priya and we shipped the PostgreSQL migration at Ordinal Systems.',
  )
})

test('the number swap runs in whichever direction the answer is already in, and fixes agreement', () => {
  const pluralised = blindVariants('I was on call, so I built the queue myself.')
  const singularised = blindVariants('We were on call, so we built the queue ourselves.')

  expect(pluralised[0]?.text).toBe('We were on call, so we built the queue ourselves.')
  expect(singularised[0]?.text).toBe('I was on call, so I built the queue myself.')
})

// "My" at the start of a sentence is the same pronoun as "my" in the middle of one, and a bare
// lowercase "i" in an answer about code is not the pronoun at all.
test('the first person is recognised by case, not by a flag that would also catch a loop variable', () => {
  const capitalised = blindVariants('My team owned the retry path. I wrote the lease check.')
  const loopVariable = blindVariants('The worker loops while i is under the batch size.')

  expect(capitalised[0]?.text).toBe('Our team owned the retry path. We wrote the lease check.')
  expect(loopVariable).toEqual([])
})

test('a transform that changes nothing produces no variant, so it cannot inflate n', () => {
  expect(blindVariants('The queue leases each row for thirty seconds.')).toEqual([])
})

const base = {
  attemptId: 'att_1',
  rubric: { id: 'claim_status', version: 1 },
  level: 'mid',
  rationale: 'cited the lease expiry path',
  modelVersion: 'model@test',
  promptVersion: 'answer-evaluation@v1',
  transcriptSpanIds: ['span_1'],
  evidenceIds: ['ev_1'],
} as const

const supported: ClaimFinding = {
  ...base,
  id: 'fnd_1',
  kind: 'claim',
  claimId: 'clm_1',
  verdict: 'supported',
  confidence: 0.75,
}

const partiallySupported: ClaimFinding = {
  ...supported,
  id: 'fnd_1b',
  verdict: 'partially_supported',
  confidence: 0.5,
}

const abstained: ClaimAbstentionFinding = {
  ...base,
  id: 'fnd_1c',
  kind: 'claim_abstained',
  claimId: 'clm_1',
  abstention: 'insufficient_evidence',
  confidence: 0.25,
}

const mechanism: CompetencyFinding = {
  ...base,
  id: 'fnd_2',
  kind: 'competency',
  competency: 'mechanism',
  levelMet: 'mid',
  confidence: 0.625,
}

test('a moved verdict and a moved confidence are both reported, per finding and in total', () => {
  expect(compareEvaluations([supported, mechanism], [partiallySupported, mechanism])).toEqual({
    compared: 2,
    verdictChanges: 1,
    abstentionChanges: 0,
    largestConfidenceShift: 0.25,
    perFinding: [
      {
        subject: 'claim:clm_1',
        presence: 'in_both',
        verdictChanged: true,
        abstentionChanged: false,
        confidenceShift: -0.25,
      },
      {
        subject: 'competency:mechanism',
        presence: 'in_both',
        verdictChanged: false,
        abstentionChanged: false,
        confidenceShift: 0,
      },
    ],
    boundary: AUDIT_BOUNDARY,
  })
})

// Judging a claim and declining to judge it are the two outcomes a blinding could move between.
// Keying them separately would have hidden that move as one finding vanishing and another appearing.
test('an evaluator that judged the claim once and abstained the second time reports an abstention change', () => {
  const delta = compareEvaluations([supported], [abstained])

  expect(delta.abstentionChanges).toBe(1)
  expect(delta.verdictChanges).toBe(0)
  expect(delta.perFinding).toEqual([
    {
      subject: 'claim:clm_1',
      presence: 'in_both',
      verdictChanged: false,
      abstentionChanged: true,
      confidenceShift: -0.5,
    },
  ])
})

test('on a topic turn, judging a competency and declining to judge it are one subject too', () => {
  const declined: CompetencyAbstentionFinding = {
    ...base,
    id: 'fnd_2b',
    rubric: { id: 'mechanism', version: 1 },
    kind: 'competency_abstained',
    competency: 'mechanism',
    abstention: 'not_verifiable',
    confidence: 0.5,
  }

  expect(compareEvaluations([mechanism], [declined]).perFinding).toEqual([
    {
      subject: 'competency:mechanism',
      presence: 'in_both',
      verdictChanged: false,
      abstentionChanged: true,
      confidenceShift: -0.125,
    },
  ])
})

test('a finding present on only one side is reported as such, not as a change of verdict', () => {
  expect(compareEvaluations([supported], [supported, mechanism]).perFinding).toEqual([
    {
      subject: 'claim:clm_1',
      presence: 'in_both',
      verdictChanged: false,
      abstentionChanged: false,
      confidenceShift: 0,
    },
    {
      subject: 'competency:mechanism',
      presence: 'variant_only',
      verdictChanged: false,
      abstentionChanged: false,
      confidenceShift: 0,
    },
  ])
})

// The delta describes what moved. It carries no field that could be read as a conclusion, and the
// boundary travels with it so it stays labelled wherever it goes.
test('the delta reports and does not conclude', () => {
  const delta = compareEvaluations([supported], [partiallySupported])

  expect(delta.boundary).toBe(AUDIT_BOUNDARY)
  expect(AUDIT_BOUNDARY).toBe('reports_a_delta_never_a_conclusion_about_bias')
  expect(Object.keys(delta)).toEqual([
    'compared',
    'verdictChanges',
    'abstentionChanges',
    'largestConfidenceShift',
    'perFinding',
    'boundary',
  ])
})
