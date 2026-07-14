export interface ModelPrice {
  inputPerMTokUsd: number
  outputPerMTokUsd: number
}

// A namespace, not a specific GGUF file — llama.cpp serves whatever happens to be mounted.
export const LOCAL_MODEL_PREFIX = 'local/'
export const LOCAL_MODEL_ALIAS = 'local/llama.cpp'

// An unpriced alias is a construction-time error, not a silent zero that would defeat the cost ceiling.
export class UnknownModelAliasError extends Error {
  constructor(readonly modelAlias: string) {
    super(
      `no price declared for model alias "${modelAlias}"; add it to MODEL_PRICES or use the ` +
        `"${LOCAL_MODEL_PREFIX}" namespace for a self-hosted model`,
    )
    this.name = 'UnknownModelAliasError'
  }
}

// Anthropic list prices, USD per million tokens.
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  'claude-fable-5': { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  'claude-mythos-5-1': { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  'claude-opus-5': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-opus-4-8': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-opus-4-7': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-opus-4-6': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  'claude-sonnet-5': { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  'claude-sonnet-4-6': { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  'claude-haiku-4-5': { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
}

const FREE: ModelPrice = { inputPerMTokUsd: 0, outputPerMTokUsd: 0 }

export function priceFor(modelAlias: string): ModelPrice {
  if (modelAlias.startsWith(LOCAL_MODEL_PREFIX)) return FREE
  const price = MODEL_PRICES[modelAlias]
  if (!price) throw new UnknownModelAliasError(modelAlias)
  return price
}

export function costUsd(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * price.inputPerMTokUsd +
    (outputTokens / 1_000_000) * price.outputPerMTokUsd
  )
}
