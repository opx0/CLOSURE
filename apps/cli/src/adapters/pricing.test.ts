import { test, expect } from 'bun:test'
import { OpenAiCompatibleConductor } from './conductor-openai.ts'
import { StructuredEvaluator } from './evaluator-structured.ts'
import { costUsd, priceFor, UnknownModelAliasError } from './pricing.ts'

test('an unknown model alias throws at construction, not at call time', () => {
  expect(
    () =>
      new OpenAiCompatibleConductor({ baseUrl: 'http://x/v1', modelAlias: 'gpt-does-not-exist' }),
  ).toThrow(UnknownModelAliasError)

  expect(
    () =>
      new StructuredEvaluator({
        modelAlias: 'claude-opus-6',
        apiKey: 'sk-test',
        localBaseUrl: 'http://x/v1',
      }),
  ).toThrow(UnknownModelAliasError)
})

test('a self-hosted alias is priced at zero, a hosted one is not', () => {
  expect(priceFor('local/llama.cpp')).toEqual({ inputPerMTokUsd: 0, outputPerMTokUsd: 0 })
  expect(priceFor('claude-opus-5')).toEqual({ inputPerMTokUsd: 5, outputPerMTokUsd: 25 })
})

test('cost is per million tokens on each side separately', () => {
  expect(costUsd(priceFor('claude-opus-5'), 200_000, 40_000)).toBeCloseTo(1 + 1, 10)
  expect(costUsd(priceFor('local/qwen2.5-3b'), 200_000, 40_000)).toBe(0)
})
