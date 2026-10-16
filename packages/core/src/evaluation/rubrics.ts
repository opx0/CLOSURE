import {
  CLAIM_STATUS_RUBRIC_ID,
  LEVEL_ORDER,
  type Competency,
  type Level,
  type LevelAnchor,
  type Rubric,
  type RubricRef,
  type RubricSet,
} from '@levelhead/contracts'

// The versioned unit is one rubric per scale (ticket 11) — this moves per rubric, never for the set.
const V1 = 1

type AnchorText = Omit<LevelAnchor, 'level'>

// Keyed by level rather than listed, so a rubric that forgets `staff` does not compile.
function anchorsByLevel(by: Record<Level, AnchorText>): LevelAnchor[] {
  return LEVEL_ORDER.map((level) => ({ level, ...by[level] }))
}

function competencyRubric(competency: Competency, by: Record<Level, AnchorText>): Rubric {
  return { ref: { id: competency, version: V1 }, scale: 'competency', anchors: anchorsByLevel(by) }
}

// Rises with level: the same résumé sentence promises more from a staff engineer than a junior.
const claimStatusRubric: Rubric = {
  ref: { id: CLAIM_STATUS_RUBRIC_ID, version: V1 },
  scale: 'claim_status',
  anchors: anchorsByLevel({
    junior: {
      expectation:
        'Supported when the answer says what the candidate personally did and describes one mechanism of how the thing worked, in their own words. Naming the technology is restating the claim, not supporting it. Partially supported when the mechanism is named but never explained. Unsupported by available evidence when the answer stays at the level of the résumé line.',
      requiredConcepts: ['personal contribution', 'one mechanism described rather than named'],
    },
    mid: {
      expectation:
        'Supported when the answer additionally separates the candidate’s work from the team’s and gives a reason for at least one decision inside it. Partially supported when the boundary of their contribution stays vague ("we built") under a direct question about it.',
      requiredConcepts: [
        'boundary between own work and the team’s',
        'a reason for one decision inside the work',
      ],
    },
    senior: {
      expectation:
        'Supported when the answer additionally names an alternative that was considered and what the chosen path cost, and states what the candidate would change now. Partially supported when the decision is defended only by outcome ("it worked") with no cost named.',
      requiredConcepts: ['an alternative considered', 'the cost of the chosen path'],
    },
    staff: {
      expectation:
        'Supported when the answer additionally connects the work to consequences outside the system — who operates it, what it obliged other teams to do, what the migration or the on-call load cost. Partially supported when the answer is technically complete but stops at the system boundary.',
      requiredConcepts: ['operational consequence', 'organizational consequence'],
    },
  }),
}

// What changes across levels is how much is volunteered and how far consequences are followed —
// never whether the answer happens to sound confident (§4.7).
export const RUBRIC_V1: Rubric[] = [
  claimStatusRubric,
  competencyRubric('mechanism', {
    junior: {
      expectation:
        'Describes the happy path end to end when prompted, in order, with the components named and the data that moves between them.',
      requiredConcepts: ['ordered happy path', 'components named'],
    },
    mid: {
      expectation:
        'Describes the happy path unprompted, says what state each component holds, and explains how the pieces coordinate — who writes what, and when.',
      requiredConcepts: ['state held by each component', 'coordination between components'],
    },
    senior: {
      expectation:
        'Names the invariant the mechanism exists to preserve and where it is enforced, and volunteers the boundary conditions where it stops holding.',
      requiredConcepts: ['the invariant', 'where it is enforced', 'boundary conditions'],
    },
    staff: {
      expectation:
        'Explains why this class of mechanism rather than the alternative class, and states what the design assumes about its environment — the assumptions that would have to change for it to be wrong.',
      requiredConcepts: ['choice of mechanism class', 'environmental assumptions'],
    },
  }),
  competencyRubric('trade_offs', {
    junior: {
      expectation:
        'Names one alternative and one reason the chosen option was preferred, when asked. "It is what we had" is an origin, not a reason, and does not meet this level.',
      requiredConcepts: ['one alternative', 'one reason for the choice'],
    },
    mid: {
      expectation:
        'States the trade as a cost paid rather than a benefit gained: names what was given up, unprompted.',
      requiredConcepts: ['what was given up'],
    },
    senior: {
      expectation:
        'Bounds or quantifies the cost, and names the condition under which the decision flips — the load, latency or team size at which the other option wins.',
      requiredConcepts: ['bounded cost', 'the condition that flips the decision'],
    },
    staff: {
      expectation:
        'Carries the trade out to operational and organizational cost: who carries the on-call, what the migration would cost, what the team can maintain.',
      requiredConcepts: ['operational cost', 'organizational cost'],
    },
  }),
  competencyRubric('failure_modes', {
    junior: {
      expectation:
        'Correctly names one failure mode when prompted. Being prompted costs nothing at this level; naming it correctly is the bar.',
      requiredConcepts: ['one correctly named failure mode'],
    },
    mid: {
      expectation:
        'Volunteers at least one failure mode unprompted and describes what the system actually does when it happens, including what the candidate did not handle.',
      requiredConcepts: ['unprompted failure mode', 'the system’s behaviour under it'],
    },
    senior: {
      expectation:
        'Volunteers several failure modes unprompted, each with its mitigation and the cost of that mitigation. Silence about a mode the design obviously has is a miss at this level, not a neutral.',
      requiredConcepts: [
        'several unprompted failure modes',
        'mitigation',
        'cost of the mitigation',
      ],
    },
    staff: {
      expectation:
        'Connects the failure modes to their operational and organizational consequences: what pages, who is woken, the blast radius, and what the business notices before the graph does.',
      requiredConcepts: ['operational consequence', 'blast radius', 'organizational consequence'],
    },
  }),
  // Every anchor rewards the true thing said under load, never the confident thing (§4.3).
  competencyRubric('composure', {
    junior: {
      expectation:
        'Says "I don’t know" or "we didn’t handle that" instead of inventing a mechanism, and finishes a thought after one follow-up.',
      requiredConcepts: ['admits the limit rather than fabricating'],
    },
    mid: {
      expectation:
        'Holds a correct position against a false premise by giving a reason, and resumes the thread after an interruption rather than restarting or losing it.',
      requiredConcepts: ['holds correct ground with a reason', 'coherence after interruption'],
    },
    senior: {
      expectation:
        'Distinguishes a challenge worth yielding to from one worth holding: revises on evidence, not on the interviewer’s status or persistence, and says which of the two is happening.',
      requiredConcepts: ['honest yielding on evidence', 'no yielding to status'],
    },
    staff: {
      expectation:
        'Stays coherent under sustained challenge and appeal to authority, keeps the exchange productive by naming what would settle the disagreement, and neither escalates nor hedges into a spiral.',
      requiredConcepts: ['sustained challenge held', 'names what would settle it'],
    },
  }),
]

// Pinning the pairs, not a set version (ticket 11), lets one competency be revised without
// invalidating the labels for the others.
export const rubricSetV1: RubricSet = RUBRIC_V1.map((rubric) => rubric.ref)

export function rubricFor(ref: RubricRef): Rubric | undefined {
  return RUBRIC_V1.find((rubric) => rubric.ref.id === ref.id && rubric.ref.version === ref.version)
}

export function anchorFor(rubric: Rubric, level: Level): LevelAnchor | undefined {
  return rubric.anchors.find((anchor) => anchor.level === level)
}
