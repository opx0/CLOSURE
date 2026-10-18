// An id names one immutable encoding contract; changing any field requires a new id and reindex.
export interface EmbeddingProfile {
  readonly id: string
  readonly model: string
  // Use the actual model artifact digest when available, never a floating model tag.
  readonly revision: string
  readonly dimensions: number
  readonly normalization: 'l2'
  readonly pooling: string
  // Includes the tokenizer revision; budgets include prefixes and special tokens.
  readonly tokenizer: string
  readonly maxInputTokens: number
  readonly preprocessingVersion: string
  readonly queryPrefix: string
  readonly documentPrefix: string
}

// Separate from generation. The adapter applies prefixes and rejects over-budget inputs and
// wrong-dimension, nonfinite, zero or non-unit vectors; storage validates vectors again.
export interface EmbeddingPort {
  readonly profile: EmbeddingProfile
  embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]>
  embedQuery(text: string): Promise<readonly number[]>
}
