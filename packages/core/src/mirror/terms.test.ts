import { expect, test } from 'bun:test'
import { untrusted } from '@levelhead/contracts'
import { extractRequiredTerms } from './terms.ts'

const JOB_DESCRIPTION = untrusted(`# Backend Engineer

We are hiring an engineer to own our ingestion pipeline.

## Requirements

- Strong experience with PostgreSQL and schema migrations.
- You have built a job queue or a durable work system.
- Familiarity with Kubernetes.

## Nice to have

- Exposure to Kafka.
`)

test('a job description becomes a ranked list of terms a keyword screen would match on', () => {
  expect(extractRequiredTerms(JOB_DESCRIPTION)).toEqual([
    { term: 'job queue', kind: 'phrase', weight: 3, underRequirement: true },
    { term: 'kubernetes', kind: 'technology', weight: 3, underRequirement: true },
    { term: 'postgresql', kind: 'technology', weight: 3, underRequirement: true },
    { term: 'schema migrations', kind: 'phrase', weight: 3, underRequirement: true },
    { term: 'backend engineer', kind: 'phrase', weight: 1, underRequirement: false },
    { term: 'engineer', kind: 'technology', weight: 1, underRequirement: false },
    { term: 'ingestion pipeline', kind: 'phrase', weight: 1, underRequirement: false },
    { term: 'kafka', kind: 'technology', weight: 1, underRequirement: false },
  ])
})

// Kafka sits under "Nice to have" and Kubernetes under "Requirements". Nothing else separates them.
test('the heading a term sits under is what ranks it, not how often it appears', () => {
  const terms = extractRequiredTerms(JOB_DESCRIPTION)
  const kubernetes = terms.find((term) => term.term === 'kubernetes')
  const kafka = terms.find((term) => term.term === 'kafka')

  expect(kubernetes).toEqual({
    term: 'kubernetes',
    kind: 'technology',
    weight: 3,
    underRequirement: true,
  })
  expect(kafka).toEqual({
    term: 'kafka',
    kind: 'technology',
    weight: 1,
    underRequirement: false,
  })
})

// Replay is the reason. A ranking that reorders between runs cannot be replayed, and a list that
// depends on the host's locale reorders on a different machine.
test('the same posting produces the same list in the same order, and the cut at the limit is stable', () => {
  expect(extractRequiredTerms(JOB_DESCRIPTION)).toEqual(extractRequiredTerms(JOB_DESCRIPTION))
  expect(extractRequiredTerms(JOB_DESCRIPTION, 3).map((term) => term.term)).toEqual([
    'job queue',
    'kubernetes',
    'postgresql',
  ])
})

test('a posting made of nothing but recruiting filler yields no terms at all', () => {
  const filler = untrusted(
    'We are looking for a strong candidate with excellent experience and a passion for the work.',
  )

  expect(extractRequiredTerms(filler)).toEqual([])
})
