import { Type, type Static } from '@sinclair/typebox'

// What an automated screen would extract from the candidate's own resume against one job
// description. It is a model of the system on the other side of an application, not a judgment of
// the candidate, and it is never the input to one.
//
// It deliberately produces no match percentage. A number here would be the aggregate score
// invariant 3 forbids, wearing a different name, and it would add nothing actionable: the useful
// output is which claims get flagged and which required terms are missing, both of which the
// candidate can go and fix.
export const MIRROR_BOUNDARY = 'simulation_of_an_external_screen_never_a_finding' as const

export const ScreenFlagSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('claim_states_no_outcome'),
    claimId: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal('claim_verb_is_vague'),
    claimId: Type.String({ minLength: 1 }),
    verb: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal('claim_unsupported_by_snapshot'),
    claimId: Type.String({ minLength: 1 }),
    snapshotId: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal('required_term_absent'),
    term: Type.String({ minLength: 1 }),
  }),
])
export type ScreenFlag = Static<typeof ScreenFlagSchema>

export const TermCoverageSchema = Type.Object({
  term: Type.String({ minLength: 1 }),
  present: Type.Boolean(),
  // Where in the resume it was found, so the candidate can check the match is not a coincidence.
  spanIds: Type.Array(Type.String({ minLength: 1 })),
})
export type TermCoverage = Static<typeof TermCoverageSchema>

export const ScreenSimulationSchema = Type.Object({
  jobDescriptionHash: Type.String({ minLength: 1 }),
  coverage: Type.Array(TermCoverageSchema),
  flags: Type.Array(ScreenFlagSchema),
  boundary: Type.Literal(MIRROR_BOUNDARY),
})
export type ScreenSimulation = Static<typeof ScreenSimulationSchema>
