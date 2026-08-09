// Ticket 05 §6 and PROJECT.md §10 stage 6: calibration needs an error taxonomy, because "the
// evaluator disagreed with a human" is not a finding anybody can act on. These are the ways this
// evaluator can be wrong, named in advance so a disagreement is classified rather than described.
//
// They are deliberately about *how* the judgment failed, never about how bad it was: a severity
// score over errors would be the aggregate this project refuses, wearing a different name.

export const EVALUATOR_ERROR_CLASSES = [
  'fabricated_evidence',
  'invented_credit',
  'missed_gap',
  'wrong_level_anchor',
  'round_mismatch',
  'composure_folded_into_correctness',
  'abstained_when_judgable',
  'judged_when_unjudgable',
  'overconfident',
  'underconfident',
] as const

export type EvaluatorErrorClass = (typeof EVALUATOR_ERROR_CLASSES)[number]

export const ERROR_CLASS_MEANING: Readonly<Record<EvaluatorErrorClass, string>> = {
  fabricated_evidence:
    'cited words that are not in the answer. Structurally prevented — every quote is re-located byte-for-byte before a finding survives — so one of these is a defect report, not a calibration datum.',
  invented_credit:
    'credited a mechanism, trade-off or mitigation the candidate never described. The sycophancy failure, in its exact form.',
  missed_gap:
    'the answer was missing something the anchor requires and the evaluator did not say so.',
  wrong_level_anchor:
    'judged against a level other than the one the session declared — a junior bar applied to a staff answer, or the reverse.',
  round_mismatch:
    'judged against what a different round asks: marking a behavioural answer down for missing queue mechanics, or crediting mechanism where ownership was asked for.',
  composure_folded_into_correctness:
    'let composure adjust a correctness verdict, or the reverse. Being right while rattled and wrong while calm are different findings.',
  abstained_when_judgable:
    'declined to judge an answer that plainly contained enough. Abstention is a first-class outcome, not a place to hide.',
  judged_when_unjudgable:
    'produced a verdict on an answer that did not contain enough to support one.',
  overconfident:
    'the verdict was right or wrong, but the stated confidence was higher than the text supports.',
  underconfident: 'the stated confidence was lower than the text supports.',
}

export function isEvaluatorErrorClass(value: unknown): value is EvaluatorErrorClass {
  return typeof value === 'string' && (EVALUATOR_ERROR_CLASSES as readonly string[]).includes(value)
}

export interface ErrorTally {
  class: EvaluatorErrorClass
  count: number
  meaning: string
}

// Counts only. No severity weighting and no total: an aggregate over error classes would be the
// readiness score again, pointed at the evaluator instead of the candidate.
export function tallyErrors(classes: readonly EvaluatorErrorClass[]): ErrorTally[] {
  const counts = new Map<EvaluatorErrorClass, number>()
  for (const one of classes) counts.set(one, (counts.get(one) ?? 0) + 1)
  return EVALUATOR_ERROR_CLASSES.filter((one) => counts.has(one)).map((one) => ({
    class: one,
    count: counts.get(one) ?? 0,
    meaning: ERROR_CLASS_MEANING[one],
  }))
}
