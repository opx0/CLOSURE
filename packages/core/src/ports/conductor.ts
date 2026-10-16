import type {
  Claim,
  InvocationRecord,
  Level,
  PersonaId,
  PolicyAction,
  RoundKind,
  Topic,
} from '@levelhead/contracts'

// §4.8: code travels with the request rather than being fetched by the renderer — the snapshot is
// deletable, and reading it is the caller's business, not the adapter's.
export interface ArtifactContext {
  artifactId: string
  path: string
  symbol?: string
  startLine?: number
  endLine?: number
  code: string
}

export interface TranscriptTurn {
  role: 'interviewer' | 'candidate'
  text: string
}

export interface RenderQuestionInput {
  // Chosen in core. The Conductor renders this intent into words; it never selects it.
  action: PolicyAction
  pressureLevel: number
  level: Level
  personaId: PersonaId
  claim: Claim | null
  // Only what the question may be phrased from; the false premise and the twist arrive as a seed.
  topic?: Pick<Topic, 'id' | 'area' | 'title' | 'ask'>
  round: RoundKind
  artifact?: ArtifactContext
  transcript: readonly TranscriptTurn[]
  // Content the action needs (e.g. FALSE_PREMISE's wrong statement) — data for the renderer, never an instruction to it.
  seed?: string
}

// No action, next-question-type or difficulty field — adding one would break "policy action chosen by code" (ticket 05 §3, tested).
export interface RenderedQuestion {
  text: string
  invocation: InvocationRecord
}

export interface RenderRoundBriefInput {
  round: RoundKind
  roundIndex: number
  totalRounds: number
  personaId: PersonaId
  claim: Claim | null
  artifact?: Pick<ArtifactContext, 'path' | 'symbol'>
}

export interface ConductorPort {
  renderQuestion(input: RenderQuestionInput): Promise<RenderedQuestion>
  // Optional: without it, a round just opens with its name — worse reading, not a worse interview.
  renderRoundBrief?(input: RenderRoundBriefInput): Promise<RenderedQuestion>
}
