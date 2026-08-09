import { describe, expect, test } from 'bun:test'
import { CLAIM_VERDICT_ORDER } from '@closer/contracts'
import {
  FLAGSHIP_AGREEMENT_MIN_N,
  LabelIndex,
  agreementAssertability,
  humanRatingsMatrix,
  labelTemplate,
  labelingDisclosure,
  parseLabels,
  withModelRater,
} from './labels.ts'
import { syntheticFixtures } from './testing/synthetic.ts'

const LINE = (over: Record<string, unknown>): string =>
  JSON.stringify({
    kind: 'claim_verdict',
    itemId: 'item-1',
    verdict: 'supported',
    labeller: 'ann',
    labelledAt: '2026-09-09',
    ...over,
  })

describe('the label file is hand-editable', () => {
  test('comments and blank lines are ignored', () => {
    const parsed = parseLabels(['# a comment', '', LINE({}), '   ', '# another'].join('\n'))
    expect(parsed.errors).toEqual([])
    expect(parsed.labels.length).toBe(1)
  })

  test('a malformed line is reported with its number, never silently skipped', () => {
    const parsed = parseLabels(['{not json', LINE({}), LINE({ verdict: 'excellent' })].join('\n'))
    expect(parsed.labels.length).toBe(1)
    expect(parsed.errors[0]).toContain('line 1')
    expect(parsed.errors[1]).toContain('line 3')
    expect(parsed.errors[1]).toContain('excellent')
  })

  test('a label with no labeller or date is refused', () => {
    const parsed = parseLabels(LINE({ labeller: undefined }))
    expect(parsed.labels).toEqual([])
    expect(parsed.errors[0]).toContain('labeller is required')
  })

  // The two abstentions are not points on the ordinal scale, so they may never enter an alpha.
  test('an abstention is not a verdict', () => {
    expect(parseLabels(LINE({ verdict: 'insufficient_evidence' })).errors.length).toBe(1)
  })

  test('the template lists the items awaiting a verdict and asserts none of them', () => {
    const template = labelTemplate(syntheticFixtures(), 'abhisek', '2026-09-09')
    expect(template).toContain('item-synthetic-1')
    expect(template).toContain('claim_verdict')
    expect(parseLabels(template).labels).toEqual([])
  })
})

describe('the ratings matrix', () => {
  const index = new LabelIndex(
    parseLabels(
      [
        LINE({ itemId: 'i1', verdict: 'supported', labeller: 'ann' }),
        LINE({ itemId: 'i1', verdict: 'partially_supported', labeller: 'bob' }),
        LINE({ itemId: 'i2', verdict: 'contradicted', labeller: 'ann' }),
      ].join('\n'),
    ).labels,
  )

  test('is units by raters, with null for a unit a rater did not label', () => {
    const matrix = humanRatingsMatrix(index)
    expect(matrix.units).toEqual(['i1', 'i2'])
    expect(matrix.raters).toEqual(['ann', 'bob'])
    expect(matrix.ratings).toEqual([
      [
        CLAIM_VERDICT_ORDER.indexOf('supported'),
        CLAIM_VERDICT_ORDER.indexOf('partially_supported'),
      ],
      [CLAIM_VERDICT_ORDER.indexOf('contradicted'), null],
    ])
  })

  test('the model enters as one more rater over exactly the human-labeled units', () => {
    const withModel = withModelRater(humanRatingsMatrix(index), (itemId) =>
      itemId === 'i1' ? 'contradicted' : null,
    )
    expect(withModel.raters).toEqual(['ann', 'bob', 'model'])
    expect(withModel.ratings[0]?.[2]).toBe(CLAIM_VERDICT_ORDER.indexOf('contradicted'))
    expect(withModel.ratings[1]?.[2]).toBeNull()
  })

  test('a tie between labellers is left unresolved rather than broken', () => {
    expect(index.adjudicated('i1')).toBeNull()
    expect(index.adjudicated('i2')).toBe('contradicted')
  })
})

describe('the n = 100 rule', () => {
  test('a small set is not assertable, and the reason says alpha still ships', () => {
    const index = new LabelIndex(
      parseLabels(
        Array.from({ length: 10 }, (_, at) =>
          [
            LINE({ itemId: `i${at}`, labeller: 'ann' }),
            LINE({ itemId: `i${at}`, labeller: 'bob' }),
          ].join('\n'),
        ).join('\n'),
      ).labels,
    )
    const check = agreementAssertability(humanRatingsMatrix(index))
    expect(check.n).toBe(10)
    expect(check.assertable).toBe(false)
    expect(check.reason).toContain('no pass or fail is asserted')
  })

  test('a single rater is never assertable, however large the set', () => {
    const index = new LabelIndex(
      parseLabels(
        Array.from({ length: FLAGSHIP_AGREEMENT_MIN_N }, (_, at) =>
          LINE({ itemId: `i${at}`, labeller: 'ann' }),
        ).join('\n'),
      ).labels,
    )
    const check = agreementAssertability(humanRatingsMatrix(index))
    expect(check.n).toBe(FLAGSHIP_AGREEMENT_MIN_N)
    expect(check.assertable).toBe(false)
    expect(check.reason).toContain('two raters')
  })

  test('solo self-labeling is computed for the disclosure, not asserted by hand', () => {
    const solo = labelingDisclosure(new LabelIndex(parseLabels(LINE({})).labels))
    expect(solo.soloSelfLabeled).toBe(true)
    const pair = labelingDisclosure(
      new LabelIndex(parseLabels([LINE({}), LINE({ labeller: 'bob' })].join('\n')).labels),
    )
    expect(pair.soloSelfLabeled).toBe(false)
  })
})
