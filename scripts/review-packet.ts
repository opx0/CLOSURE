import { loadFeedbackCases } from '../benchmarks/src/feedback/cases.ts'
import { reviewPacket } from '../benchmarks/src/feedback/review-packet.ts'

const split = process.argv[2]
if (split !== 'tuning' && split !== 'heldout')
  throw new Error('Usage: bun run review:packet tuning|heldout')
console.log(JSON.stringify(reviewPacket(await loadFeedbackCases(), split), null, 2))
