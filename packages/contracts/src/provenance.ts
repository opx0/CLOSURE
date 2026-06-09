import { Type, type Static } from '@sinclair/typebox'

// Byte offsets, not character offsets — validity is checked against the source bytes exactly (ticket 05 §3).
export const SpanSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  sourceId: Type.String({ minLength: 1 }),
  startByte: Type.Integer({ minimum: 0 }),
  endByte: Type.Integer({ minimum: 0 }),
  quoted: Type.String(),
})
export type Span = Static<typeof SpanSchema>

export const ArtifactKindSchema = Type.Union([
  Type.Literal('file'),
  Type.Literal('function'),
  Type.Literal('commit'),
  Type.Literal('pull_request'),
])
export type ArtifactKind = Static<typeof ArtifactKindSchema>

// An artifact lives inside a deletable snapshot; a span does not — different retention is why they're not one type.
export const ArtifactSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  snapshotId: Type.String({ minLength: 1 }),
  kind: ArtifactKindSchema,
  path: Type.String({ minLength: 1 }),
  symbol: Type.Optional(Type.String({ minLength: 1 })),
  // 1-based, inclusive, absent for a whole file. Lines, not byte offsets: still reads as a citation after the deletable snapshot is gone.
  startLine: Type.Optional(Type.Integer({ minimum: 1 })),
  endLine: Type.Optional(Type.Integer({ minimum: 1 })),
})
export type Artifact = Static<typeof ArtifactSchema>

export const EvidenceTrustSchema = Type.Union([
  Type.Literal('candidate_asserted'),
  Type.Literal('repository_observed'),
  Type.Literal('transcript_observed'),
])
export type EvidenceTrust = Static<typeof EvidenceTrustSchema>

export const EvidenceTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('span'), spanId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('artifact'), artifactId: Type.String({ minLength: 1 }) }),
])

// A composure/competency finding is about an attempt, never a claim — routing it through a claim id would mint a join that looks real and isn't.
export const EvidenceSubjectSchema = Type.Union([
  Type.Object({ kind: Type.Literal('claim'), claimId: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('attempt'), attemptId: Type.String({ minLength: 1 }) }),
])
export type EvidenceSubject = Static<typeof EvidenceSubjectSchema>

// Evidence is the link between a subject and what bears on it, never the text or code itself — it flags what deserves examination, it never proves anything.
export const EvidenceSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  subject: EvidenceSubjectSchema,
  target: EvidenceTargetSchema,
  trust: EvidenceTrustSchema,
})
export type Evidence = Static<typeof EvidenceSchema>
