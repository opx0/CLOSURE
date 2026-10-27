import { loadFeedbackCases } from '../benchmarks/src/feedback/cases.ts'

const fixtures = await loadFeedbackCases(process.argv[2])
console.log(
  JSON.stringify(
    {
      version: fixtures.version,
      reviewer: fixtures.reviewer,
      cases: fixtures.cases.length,
      tuning: fixtures.cases.filter((entry) => entry.split === 'tuning').length,
      heldout: fixtures.cases.filter((entry) => entry.split === 'heldout').length,
      validation:
        'schema, split isolation and reference quotes only; no evaluator accuracy measured',
    },
    null,
    2,
  ),
)
