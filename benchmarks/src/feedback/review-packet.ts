import type { FeedbackCaseSet } from './cases.ts'

export function reviewPacket(fixtures: FeedbackCaseSet, split: 'tuning' | 'heldout') {
  return {
    version: fixtures.version,
    split,
    disclosure:
      'Public synthetic cases; agent-authored references have not been independently reviewed.',
    cases: fixtures.cases
      .filter((entry) => entry.split === split)
      .map((entry) => ({
        id: entry.id,
        family: entry.family,
        split: entry.split,
        kind: entry.kind,
        question: entry.question,
        answer: entry.answer,
        ...(entry.originalAnswer === undefined ? {} : { originalAnswer: entry.originalAnswer }),
        ...(entry.source === undefined ? {} : { source: entry.source }),
        ...(entry.sourceState === undefined ? {} : { sourceState: entry.sourceState }),
      })),
  }
}
