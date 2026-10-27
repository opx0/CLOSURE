import { readFile } from 'node:fs/promises'
import { loadFeedbackCases } from '../benchmarks/src/feedback/cases.ts'
import { validateReviewRecords } from '../benchmarks/src/feedback/review-records.ts'

const [split, file] = process.argv.slice(2)
if ((split !== 'tuning' && split !== 'heldout') || !file)
  throw new Error('Usage: bun run review:validate tuning|heldout REVIEW.jsonl')
const result = validateReviewRecords(await readFile(file, 'utf8'), await loadFeedbackCases(), split)
console.log(
  JSON.stringify(
    {
      ...result,
      boundary:
        'Structural validation only; no reviewer qualification, agreement or model accuracy is established.',
    },
    null,
    2,
  ),
)
if (result.errors.length) process.exitCode = 1
