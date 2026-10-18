import { expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { evaluate } from './evaluate.ts'
import { cases, validateCases } from './cases.ts'
import { corpus } from './corpus.ts'
import { main, parseArgs } from './cli.ts'

test('public evaluator calculates a literal ranked relevance example', async () => {
  const report = await evaluate({
    cases: [
      {
        id: 'worked',
        family: 'worked',
        split: 'heldout',
        query: 'example',
        relevant: { a: 3, b: 1 },
      },
    ],
    strategies: { example: async () => [{ artifactId: 'x' }, { artifactId: 'a' }] },
    k: 3,
    clock: () => 0,
  })
  const row = report.results[0]!
  expect(row.metrics?.precision).toBeCloseTo(1 / 3)
  expect(row.metrics?.recall).toBe(0.5)
  expect(row.metrics?.reciprocalRank).toBe(0.5)
  // DCG = 7/log2(3), IDCG = 7 + 1/log2(3).
  expect(row.metrics?.ndcg).toBeCloseTo(0.578764111)
})

test('authored judgments isolate tuning and heldout source families', () => {
  expect(() => validateCases(cases, corpus)).not.toThrow()
  expect(cases.filter((query) => query.split === 'tuning')).toHaveLength(6)
  expect(cases.filter((query) => query.split === 'heldout')).toHaveLength(12)
  expect(() =>
    validateCases([...cases, { ...cases[0]!, id: 'leak', split: 'heldout' }], corpus),
  ).toThrow('family')
  expect(cases.find((query) => query.id === 'contradictory-code')?.relevant).toEqual({
    'auth-plaintext': 3,
  })
})

test('overlapping chunks count once and short result lists keep denominator k', async () => {
  const report = await evaluate({
    cases: [
      {
        id: 'overlap',
        family: 'ledger',
        split: 'heldout',
        query: 'replay',
        relevant: { a: 3, b: 1 },
      },
    ],
    strategies: {
      chunks: async () => [
        { artifactId: 'a', chunkId: '1' },
        { artifactId: 'a', chunkId: '2' },
        { artifactId: 'b', chunkId: '3' },
      ],
    },
    k: 3,
    clock: () => 0,
  })
  expect(report.results[0]?.artifactIds).toEqual(['a', 'b'])
  expect(report.results[0]?.metrics).toEqual({
    precision: 2 / 3,
    recall: 1,
    reciprocalRank: 1,
    ndcg: 1,
    noAnswerFalseHits: null,
  })
})

test('no-answer false hits are separate from answerable relevance metrics', async () => {
  const report = await evaluate({
    cases: [{ id: 'missing', family: 'missing', split: 'heldout', query: 'missing', relevant: {} }],
    strategies: { noisy: async () => [{ artifactId: 'x' }], abstain: async () => [] },
    k: 2,
    clock: () => 0,
  })
  expect(report.results.map((row) => row.metrics)).toEqual([
    { precision: null, recall: null, reciprocalRank: null, ndcg: null, noAnswerFalseHits: 0 },
    { precision: null, recall: null, reciprocalRank: null, ndcg: null, noAnswerFalseHits: 1 },
  ])
})

test('strategy errors preserve the failed query, continue comparisons, and fail the run', async () => {
  const query = {
    id: 'failure',
    family: 'missing',
    split: 'heldout' as const,
    query: 'missing',
    relevant: {},
  }
  const report = await evaluate({
    cases: [query],
    strategies: {
      unavailable: async () => {
        throw new Error('Postgres unavailable')
      },
      working: async () => [],
    },
    k: 2,
    clock: () => 0,
  })
  expect(report.success).toBe(false)
  expect(report.results[0]?.error).toBe('Postgres unavailable')
  expect(report.results[0]?.metrics).toBeNull()
  expect(report.results[1]?.error).toBeNull()
})

test('semantic output and ordering are deterministic with a supplied clock', async () => {
  const input = {
    cases: cases.slice(0, 2),
    strategies: { z: async () => [], a: async () => [] },
    k: 3,
    clock: () => 7,
  }
  expect(await evaluate(input)).toEqual(await evaluate(input))
  expect((await evaluate(input)).results.map((row) => row.strategy)).toEqual(['a', 'a', 'z', 'z'])
})

test('invalid evaluation budgets reject instead of generating misleading metrics', async () => {
  await expect(evaluate({ cases, strategies: {}, k: 0 })).rejects.toThrow('k')
  await expect(
    evaluate({ cases: [], strategies: { empty: async () => [] }, k: 3 }),
  ).rejects.toThrow('case')
  await expect(
    evaluate({ cases: [cases[0]!, cases[0]!], strategies: { empty: async () => [] }, k: 3 }),
  ).rejects.toThrow('Duplicate')
})

test('summaries separate heldout, no-answer and failed rows, with paired query deltas', async () => {
  const report = await evaluate({
    cases: [
      { id: 'answer', family: 'x', split: 'heldout', query: 'x', relevant: { a: 3 } },
      { id: 'none', family: 'x', split: 'heldout', query: 'none', relevant: {} },
    ],
    strategies: {
      baseline: async () => [],
      candidate: async () => [{ artifactId: 'a' }],
    },
    baseline: 'baseline',
    k: 2,
    clock: () => 0,
  })
  expect(report.summaries.find((row) => row.strategy === 'candidate')).toMatchObject({
    split: 'heldout',
    answerable: 1,
    noAnswer: 1,
    failures: 0,
    precision: 0.5,
    recall: 1,
    mrr: 1,
    ndcg: 1,
    noAnswerFalseHitRate: 1,
  })
  expect(report.comparisons[0]).toMatchObject({
    caseId: 'answer',
    baseline: 'baseline',
    candidate: 'candidate',
    precisionDelta: 0.5,
    recallDelta: 1,
    reciprocalRankDelta: 1,
  })
})

test('CLI requires an explicit temporary report path and refuses misleading partial modes', () => {
  expect(() => parseArgs([])).toThrow('--out')
  expect(() => parseArgs(['--out', 'reports/result.json'])).toThrow('/tmp/opencode')
  expect(() => parseArgs(['--out', '/tmp/opencode/result.json', '--mode', 'dense'])).toThrow('mode')
  expect(() => parseArgs(['--out', '/tmp/opencode/result.json', '--hosted'])).toThrow('Unknown')
  expect(parseArgs(['--out', '/tmp/opencode/result.json', '--mode', 'lexical-only'])).toEqual({
    out: '/tmp/opencode/result.json',
    mode: 'lexical-only',
    split: 'all',
    k: 3,
  })
})

test('an answerable total miss is zero, not an abstention or no-answer success', async () => {
  const report = await evaluate({
    cases: [{ id: 'miss', family: 'x', split: 'heldout', query: 'x', relevant: { a: 3 } }],
    strategies: { miss: async () => [] },
    k: 3,
    clock: () => 0,
  })
  expect(report.results[0]?.metrics).toEqual({
    precision: 0,
    recall: 0,
    reciprocalRank: 0,
    ndcg: 0,
    noAnswerFalseHits: null,
  })
})

test('a failed strategy never acquires zero-valued relevance or no-answer scores', async () => {
  const report = await evaluate({
    cases,
    strategies: {
      failed: async () => {
        throw new Error('dependency failed')
      },
    },
    k: 3,
    clock: () => 0,
  })
  expect(report.summaries).toMatchObject([
    {
      split: 'tuning',
      failures: 6,
      answerable: 0,
      noAnswer: 0,
      precision: null,
      noAnswerFalseHitRate: null,
    },
    {
      split: 'heldout',
      failures: 12,
      answerable: 0,
      noAnswer: 0,
      precision: null,
      noAnswerFalseHitRate: null,
    },
  ])
})

test('CLI fails closed with a failure report when its explicit database dependency is absent', async () => {
  const out = `${await mkdtemp('/tmp/opencode/enm62-eval-')}/dependency-failure.json`
  expect(await main(['--out', out, '--mode', 'lexical-only'], {})).toBe(1)
  const report = JSON.parse(await readFile(out, 'utf8'))
  expect(report.success).toBe(false)
  expect(report.error).toContain('RETRIEVAL_BENCH_DATABASE_URL')
  expect(report.coverage).toContain('NOT COMPLETE')
  expect(report.dataset.artifacts).toBe(14)
  expect(report.dataset.queries).toBe(18)
  expect(report.resource.embeddingTokens).toBeNull()
  expect(report.results).toBeUndefined()
})

test('complete CLI mode requires a pinned real embedding configuration', async () => {
  const out = `${await mkdtemp('/tmp/opencode/enm62-eval-')}/embedding-config-failure.json`
  expect(
    await main(['--out', out], {
      RETRIEVAL_BENCH_DATABASE_URL: 'postgres://127.0.0.1:1/disposable',
    }),
  ).toBe(1)
  const report = JSON.parse(await readFile(out, 'utf8'))
  expect(report.success).toBe(false)
  expect(report.error).toContain('exact SHA256')
  expect(report.results).toBeUndefined()
})

test('complete CLI mode rejects a hosted embedding endpoint before any service call', async () => {
  const out = `${await mkdtemp('/tmp/opencode/enm62-eval-')}/hosted-refused.json`
  expect(
    await main(['--out', out], {
      RETRIEVAL_BENCH_DATABASE_URL: 'postgres://127.0.0.1:1/disposable',
      RETRIEVAL_BENCH_EMBEDDING_MODEL: 'authored-config-not-a-real-model',
      RETRIEVAL_BENCH_EMBEDDING_REVISION: `sha256:${'a'.repeat(64)}`,
      RETRIEVAL_BENCH_EMBEDDING_DIMENSIONS: '3',
      RETRIEVAL_BENCH_EMBEDDING_URL: 'http://hosted.invalid',
    }),
  ).toBe(1)
  const report = JSON.parse(await readFile(out, 'utf8'))
  expect(report.success).toBe(false)
  expect(report.error).toContain('loopback')
})
