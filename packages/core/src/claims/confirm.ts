import type { Claim, InvocationRecord, Span, StateChangeOf } from '@closer/contracts'

// The envelope (session, seq, causedBy, occurredAt) belongs to whoever appends — core only builds the payload.
export function claimsExtractedPayload(input: {
  claims: Claim[]
  spans: Span[]
  invocation: InvocationRecord
}): StateChangeOf<'claims_extracted'> {
  return {
    change: 'claims_extracted',
    claims: input.claims,
    spans: input.spans,
    invocation: input.invocation,
  }
}

export function claimConfirmedPayload(input: {
  claimId: string
  confirmed: boolean
  editedAssertion?: string
}): StateChangeOf<'claim_confirmed'> {
  // Ternary, not a spread — under exactOptionalPropertyTypes, absent vs. undefined changes what replay sees.
  return input.editedAssertion === undefined
    ? { change: 'claim_confirmed', claimId: input.claimId, confirmed: input.confirmed }
    : {
        change: 'claim_confirmed',
        claimId: input.claimId,
        confirmed: input.confirmed,
        editedAssertion: input.editedAssertion,
      }
}
