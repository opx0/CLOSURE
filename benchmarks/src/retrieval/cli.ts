import { resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Artifact, Claim } from '@levelhead/contracts'
import type {
  EmbeddingPort,
  RetrievalPort,
  RetrievalStrategy as SearchStrategy,
} from '@levelhead/core'
import { cases, CASES_VERSION, validateCases } from './cases.ts'
import { corpus, CORPUS_VERSION } from './corpus.ts'
import { evaluate, type RetrievalStrategy } from './evaluate.ts'

export interface RetrievalArgs {
  out: string
  mode: 'complete' | 'lexical-only'
  split: 'all' | 'tuning' | 'heldout'
  k: number
}

export function parseArgs(argv: readonly string[]): RetrievalArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!
    if (!['--out', '--mode', '--split', '--k'].includes(key))
      throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--') || values.has(key))
      throw new Error(`Missing or duplicate argument: ${key}`)
    values.set(key, value)
  }
  const rawOut = values.get('--out')
  if (!rawOut) throw new Error('Required: --out /tmp/opencode/<report>.json')
  const out = resolve(rawOut)
  if (!out.startsWith(`/tmp/opencode${sep}`)) throw new Error('--out must be under /tmp/opencode')
  const mode = values.get('--mode') ?? 'complete'
  if (mode !== 'complete' && mode !== 'lexical-only')
    throw new Error('--mode must be complete or lexical-only')
  const split = values.get('--split') ?? 'all'
  if (split !== 'all' && split !== 'tuning' && split !== 'heldout')
    throw new Error('--split must be all, tuning or heldout')
  const k = Number(values.get('--k') ?? 3)
  if (!Number.isSafeInteger(k) || k < 1 || k > 100)
    throw new Error('--k must be an integer from 1 to 100')
  return { out, mode, split, k }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function sourceHashes() {
  const paths = [
    'benchmarks/package.json',
    'benchmarks/src/retrieval/corpus.ts',
    'benchmarks/src/retrieval/cases.ts',
    'benchmarks/src/retrieval/metrics.ts',
    'benchmarks/src/retrieval/evaluate.ts',
    'benchmarks/src/retrieval/cli.ts',
    'packages/core/src/ports/embedding.ts',
    'packages/core/src/ports/retrieval.ts',
    'packages/core/src/repo/select.ts',
    'packages/core/src/retrieval/chunks.ts',
    'packages/core/src/retrieval/ranking.ts',
    'packages/db/src/retrieval.ts',
    'apps/cli/src/adapters/embedding-local.ts',
  ]
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => {
        try {
          return [path, hash(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'))]
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [path, null]
          throw error
        }
      }),
    ),
  )
}

function queryClaim(id: string, assertion: string): Claim {
  return {
    id,
    spanId: 'authored-query',
    type: 'built',
    assertion,
    technologies: [],
    metrics: [],
    implied: false,
    confirmedByCandidate: true,
    extractorVersion: 'authored-query-not-a-candidate-claim-v1',
  }
}

async function localEmbedding(env: NodeJS.ProcessEnv) {
  const { LocalEmbeddingAdapter } =
    await import('../../../apps/cli/src/adapters/embedding-local.ts')
  const model = env['RETRIEVAL_BENCH_EMBEDDING_MODEL']
  const revision = env['RETRIEVAL_BENCH_EMBEDDING_REVISION']
  const dimensions = Number(env['RETRIEVAL_BENCH_EMBEDDING_DIMENSIONS'])
  if (!model || !revision || !Number.isSafeInteger(dimensions) || dimensions < 1) {
    throw new Error(
      'Complete mode requires RETRIEVAL_BENCH_EMBEDDING_MODEL, RETRIEVAL_BENCH_EMBEDDING_REVISION (exact SHA256), and RETRIEVAL_BENCH_EMBEDDING_DIMENSIONS',
    )
  }
  const adapter = new LocalEmbeddingAdapter({
    baseUrl: env['RETRIEVAL_BENCH_EMBEDDING_URL'] ?? 'http://127.0.0.1:11434',
    model,
    revision,
    dimensions,
    maxInputTokens: Number(env['RETRIEVAL_BENCH_EMBEDDING_MAX_INPUT_TOKENS'] ?? 512),
    queryPrefix: env['RETRIEVAL_BENCH_EMBEDDING_QUERY_PREFIX'] ?? '',
    documentPrefix: env['RETRIEVAL_BENCH_EMBEDDING_DOCUMENT_PREFIX'] ?? '',
  })
  const observations = {
    documentPortCalls: 0,
    queryPortCalls: 0,
    attemptedDocumentInputs: 0,
    attemptedQueryInputs: 0,
    attemptedInputUtf8BytesIncludingPrefixes: 0,
    attemptedInputTokenUpperBound: 0,
    successfulDocumentVectors: 0,
    successfulQueryVectors: 0,
    elapsedMs: 0,
    actualTokens: null,
    httpRequests: null,
    interpretation:
      'Port-level attempts and successful vectors; token upper bound is UTF8 bytes plus 8 special tokens per input, not measured usage. Includes lifecycle probes.',
  }
  const observeInput = (text: string, prefix: string) => {
    const bytes = Buffer.byteLength(prefix + text, 'utf8')
    observations.attemptedInputUtf8BytesIncludingPrefixes += bytes
    observations.attemptedInputTokenUpperBound += bytes + 8
  }
  const embedding: EmbeddingPort = {
    profile: adapter.profile,
    async embedDocuments(texts) {
      observations.documentPortCalls++
      observations.attemptedDocumentInputs += texts.length
      texts.forEach((text) => observeInput(text, adapter.profile.documentPrefix))
      const start = performance.now()
      try {
        const vectors = await adapter.embedDocuments(texts)
        observations.successfulDocumentVectors += vectors.length
        return vectors
      } finally {
        observations.elapsedMs += performance.now() - start
      }
    },
    async embedQuery(text) {
      observations.queryPortCalls++
      observations.attemptedQueryInputs++
      observeInput(text, adapter.profile.queryPrefix)
      const start = performance.now()
      try {
        const vector = await adapter.embedQuery(text)
        observations.successfulQueryVectors++
        return vector
      } finally {
        observations.elapsedMs += performance.now() - start
      }
    },
  }
  return { embedding, observations }
}

/** Uses only a deliberately configured benchmark database, never the application's default DB.
 * Rows have a fresh owner/snapshot namespace. Source/cache cleanup runs in finally; the fixture
 * tombstone may remain. The caller must provision a disposable migrated database separately. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let args: RetrievalArgs
  try {
    args = parseArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  const startedAt = new Date().toISOString()
  const start = performance.now()
  const cpu = process.cpuUsage()
  const memoryBefore = process.memoryUsage()
  const metadata = {
    version: 'enm62-retrieval-eval-v1',
    startedAt,
    dataset: {
      origin: 'authored-fixtures-not-personal-or-empirical',
      corpusVersion: CORPUS_VERSION,
      casesVersion: CASES_VERSION,
      corpusHash: hash(JSON.stringify(corpus)),
      casesHash: hash(JSON.stringify(cases)),
      artifacts: corpus.length,
      queries: cases.length,
      tuningQueries: cases.filter((query) => query.split === 'tuning').length,
      heldoutQueries: cases.filter((query) => query.split === 'heldout').length,
      splitPolicy:
        'Disjoint positive-source/query families; one identical indexed corpus for every strategy.',
      judgmentUnit:
        'artifact; overlapping chunks collapse before top-k; all unlisted artifacts grade zero',
      precisionDenominator: 'k even for fewer than k returned distinct artifacts',
      review:
        'Authored labels reviewed against fixture text by implementation agent; independent human review not performed.',
    },
    mode: args.mode,
    split: args.split,
    coverage:
      args.mode === 'complete'
        ? 'lexical-dense-hybrid-and-heuristics'
        : 'LEXICAL ONLY — NOT COMPLETE',
    runtime: { bun: Bun.version, node: process.version },
    aggregation:
      'Relevance means use successful answerable rows only; no-answer rates use successful no-answer rows only. Failures stay separate and fail the run.',
    limitations: [
      'Authored fixtures measure implementation behavior, not personal-corpus effectiveness or competence.',
      'Heldout families are reserved from tuning, not independently collected or externally validated.',
      'Query text is adapted to a synthetic claim for existing heuristics; no gold evidence links are supplied.',
      'Latency includes adapter calls; cold/warm caches and external model memory are not controlled.',
      'Token usage and external database/model process resources are unobserved, not zero.',
    ],
  }
  let result: Record<string, unknown> = {}
  let success: boolean
  let errorMessage: string | null = null
  try {
    result['sourceHashes'] = await sourceHashes()
    validateCases(cases, corpus)
    const url = env['RETRIEVAL_BENCH_DATABASE_URL']
    if (!url)
      throw new Error(
        'RETRIEVAL_BENCH_DATABASE_URL is required (explicit disposable migrated database)',
      )
    const local = args.mode === 'complete' ? await localEmbedding(env) : undefined
    const [{ default: pg }, { PostgresRetrieval }, core] = await Promise.all([
      import('pg'),
      import('../../../packages/db/src/index.ts'),
      import('@levelhead/core'),
    ])
    const searchModes: SearchStrategy[] = local ? ['lexical', 'dense', 'hybrid'] : ['lexical']
    const chunking = {
      chunkMaxTokens: Math.min(
        256,
        (local?.embedding.profile.maxInputTokens ?? 256) -
          Buffer.byteLength(local?.embedding.profile.documentPrefix ?? '', 'utf8') -
          8,
      ),
      chunkOverlapTokens: 32,
    }
    result = {
      ...result,
      embeddingProfile: local?.embedding.profile ?? null,
      embeddingObservations: local?.observations ?? null,
      chunking: {
        ...chunking,
        tokenBudgetMethod:
          'UTF8 bytes plus 16 framing tokens; provisional bound, not measured tokenizer usage',
      },
    }
    const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 })
    const ownerId = `retrieval-bench-${randomUUID()}`
    const snapshotId = `retrieval-bench-${randomUUID()}`
    const entries = corpus.map((fixture) => ({
      artifact: {
        id: `${snapshotId}:${fixture.id}`,
        snapshotId,
        kind: fixture.path.endsWith('.md') ? ('file' as const) : ('function' as const),
        path: fixture.path,
        symbol: fixture.symbol,
        startLine: 1,
        endLine: fixture.text.split('\n').length,
      },
      text: fixture.text,
    }))
    const artifacts: Artifact[] = entries.map((entry) => entry.artifact)
    const fixtureIds = new Map(
      entries.map((entry, index) => [entry.artifact.id, corpus[index]!.id]),
    )
    const toFixtureId = (id: string): string => fixtureIds.get(id) ?? `OUT_OF_CORPUS:${id}`
    let recorded = false
    let deleted = false
    const retrieval: RetrievalPort &
      Pick<InstanceType<typeof PostgresRetrieval>, 'recordSnapshot' | 'markDeleted'> =
      new PostgresRetrieval(pool, {
        ...chunking,
        ...(local ? { embedding: local.embedding } : {}),
      })
    try {
      const { rows } = await pool.query(`select current_setting('server_version') as postgres,
        (select extversion from pg_extension where extname = 'vector') as pgvector`)
      result['databaseVersions'] = rows[0] ?? null
      if (local && !rows[0]?.['pgvector'])
        throw new Error('Complete mode requires the pgvector extension')
      const indexStart = performance.now()
      await retrieval.recordSnapshot(
        ownerId,
        {
          id: snapshotId,
          repoPath: 'authored://enm62-fixtures',
          commit: metadata.dataset.corpusHash.slice(0, 40),
          fileCount: corpus.length,
          pinnedAt: startedAt,
        },
        metadata.dataset.corpusHash,
      )
      recorded = true
      await retrieval.index(ownerId, snapshotId, entries)
      const indexingMs = performance.now() - indexStart
      const strategies: Record<string, RetrievalStrategy> = {
        'heuristic-match': async (query, k) =>
          core
            .matchArtifacts(artifacts, queryClaim(query.id, query.query), k)
            .map((hit) => ({ artifactId: toFixtureId(hit.artifact.id) })),
        'heuristic-rank': async (query, k) => {
          const claim = queryClaim(query.id, query.query)
          const matches = core.matchArtifacts(artifacts, claim, core.LINKS_PER_CLAIM)
          const evidence = core.linkArtifactsToClaim(
            matches.map((match) => match.artifact),
            claim,
            { next: () => randomUUID() },
          )
          return core
            .rankArtifacts({ artifacts, claims: [claim], evidence })
            .slice(0, k)
            .map((hit) => ({ artifactId: toFixtureId(hit.artifact.id) }))
        },
      }
      for (const strategy of searchModes) {
        strategies[strategy] = async (query, k) =>
          (await retrieval.search(ownerId, snapshotId, query.query, k, { strategy })).map(
            (hit) => ({
              artifactId: toFixtureId(hit.artifact.id),
              ...(hit.chunk ? { chunkId: hit.chunk.id } : {}),
            }),
          )
      }
      const report = await evaluate({
        cases: cases.filter((query) => args.split === 'all' || query.split === args.split),
        strategies,
        k: args.k,
        baseline: 'heuristic-match',
      })
      result = {
        ...result,
        ...report,
        indexingMs,
        snapshotId,
        ownerId,
        executedStrategies: Object.keys(strategies).sort(),
        evaluatedQueries: report.results.length / Object.keys(strategies).length,
      }
      const checks: { name: string; passed: boolean }[] = []
      result['lifecycleChecks'] = checks
      for (const strategy of searchModes) {
        for (const [name, owner, snapshot] of [
          ['wrong-owner', `${ownerId}-other`, snapshotId],
          ['wrong-snapshot', ownerId, `${snapshotId}-other`],
        ] as const) {
          checks.push({
            name: `${strategy}:${name}`,
            passed:
              (await retrieval.search(owner, snapshot, 'claimJob', args.k, { strategy })).length ===
              0,
          })
        }
      }
      if (local) {
        const wrongProfile = new PostgresRetrieval(pool, {
          ...chunking,
          embedding: {
            ...local.embedding,
            profile: {
              ...local.embedding.profile,
              id: `${local.embedding.profile.id}:deliberately-wrong-version`,
              preprocessingVersion: `${local.embedding.profile.preprocessingVersion}:wrong-version`,
            },
          },
        })
        for (const strategy of ['dense', 'hybrid'] as const) {
          let rejected = false
          try {
            await wrongProfile.search(ownerId, snapshotId, 'claimJob', args.k, { strategy })
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !error.message.includes('snapshot encoding profile mismatch')
            )
              throw error
            rejected = true
          }
          checks.push({ name: `${strategy}:encoding-profile-mismatch`, passed: rejected })
        }
      }
      await retrieval.markDeleted(
        ownerId,
        snapshotId,
        'authored_benchmark_cleanup',
        new Date().toISOString(),
      )
      deleted = true
      for (const strategy of searchModes) {
        checks.push({
          name: `${strategy}:deleted-snapshot`,
          passed:
            (await retrieval.search(ownerId, snapshotId, 'claimJob', args.k, { strategy }))
              .length === 0,
        })
      }
      success = report.success && checks.every((check) => check.passed)
    } finally {
      try {
        if (recorded && !deleted)
          await retrieval.markDeleted(
            ownerId,
            snapshotId,
            'authored_benchmark_cleanup',
            new Date().toISOString(),
          )
      } catch (error) {
        success = false
        result['cleanupError'] = error instanceof Error ? error.message : String(error)
      } finally {
        try {
          await pool.end()
        } catch (error) {
          success = false
          result['poolCloseError'] = error instanceof Error ? error.message : String(error)
        }
      }
    }
  } catch (error) {
    success = false
    errorMessage = error instanceof Error ? error.message : String(error)
  }
  const resource = {
    elapsedMs: performance.now() - start,
    processCpuMicroseconds: process.cpuUsage(cpu),
    memoryBefore,
    memoryAfter: process.memoryUsage(),
    measuredScope: 'benchmark process only; before/after samples, not peak RSS',
    modelAndDatabaseResources: null,
    embeddingTokens: null,
  }
  try {
    await mkdir(dirname(args.out), { recursive: true })
    await writeFile(
      args.out,
      `${JSON.stringify({ ...metadata, ...result, success, error: errorMessage, resource }, null, 2)}\n`,
      { flag: 'wx' },
    )
  } catch (error) {
    console.error(`Cannot write report: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  console.log(`${success ? 'Completed' : 'FAILED'} ${args.mode}: ${args.out}`)
  return success ? 0 : 1
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
