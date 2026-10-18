import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { InvocationRecord } from '@levelhead/contracts'
import { LOCAL_OWNER_ID } from '@levelhead/contracts'
import type { ConductorPort, EvaluatorPort, RepositoryContext } from '@levelhead/core'
import { PostgresRetrieval, runMigrations } from '@levelhead/db'
import { asData } from '../../../packages/prompts/src/registry.ts'
import { OpenAiCompatibleConductor } from '../../../apps/cli/src/adapters/conductor-openai.ts'
import { StructuredEvaluator } from '../../../apps/cli/src/adapters/evaluator-structured.ts'
import { LocalEmbeddingAdapter } from '../../../apps/cli/src/adapters/embedding-local.ts'
import { testApi } from '../../../apps/server/src/testing/harness.ts'
import { openTestDatabase } from '../../../packages/db/src/testing/postgres.ts'
import {
  assessGeneration,
  availableBytes,
  generationConfig,
  GENERATION_CASES,
  GENERATION_FILES,
  GENERATION_FIXTURE_VERSION,
  validateGenerationMetadata,
  hasObviousMarkerObedience,
  type GenerationMetadata,
} from './generation-support.ts'

const GiB = 1024 ** 3
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
class CheckFailure extends Error {}
const requireCheck = (condition: unknown, code: string): void => {
  if (!condition) throw new CheckFailure(code)
}

// A separate process owns this fetch guard. It never rewrites prompts, outputs or model selection.
// Not a physical outbound-network boundary; the local services remain trusted.
async function run(report: Record<string, unknown>) {
  report.stage = 'configuration'
  const config = generationConfig(process.env)
  report.stage = 'startup_headroom'
  const headroom = async () => availableBytes(await readFile('/proc/meminfo', 'utf8'))
  report.startupAvailableBytes = await headroom()
  requireCheck(Number(report.startupAvailableBytes) >= 3 * GiB, 'startup_headroom_below_3GiB')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 180_000)
  let minAvailable = Number(report.startupAvailableBytes)
  let monitoring = false
  const monitor = setInterval(() => {
    if (monitoring) return
    monitoring = true
    void headroom()
      .then((bytes) => {
        minAvailable = Math.min(minAvailable, bytes)
        if (bytes < 1.5 * GiB) controller.abort()
      })
      .catch(() => controller.abort())
      .finally(() => {
        monitoring = false
      })
  }, 250)
  const nativeFetch = globalThis.fetch
  const calls: { origin: string; path: string; bodyHash?: string; status?: number }[] = []
  report.http = calls
  const guardedFetch: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requireCheck(
        [config.origin, config.embeddingOrigin].includes(url.origin),
        'non_allowlisted_fetch_refused',
      )
      requireCheck(!url.username && !url.password, 'credentialed_url_refused')
      const entry = {
        origin: url.origin,
        path: url.pathname,
        ...(typeof init?.body === 'string' ? { bodyHash: hash(init.body) } : {}),
      }
      calls.push(entry)
      if (url.pathname === '/v1/chat/completions') {
        report.completionRequests = Number(report.completionRequests ?? 0) + 1
      }
      const response = await nativeFetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(60_000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      })
      Object.assign(entry, { status: response.status })
      return response
    },
    { preconnect: nativeFetch.preconnect },
  )
  globalThis.fetch = guardedFetch
  let database: Awaited<ReturnType<typeof openTestDatabase>>
  let api: Awaited<ReturnType<typeof testApi>> | undefined
  let dir: string | undefined
  try {
    report.stage = 'generation_runtime_identity'
    const metadata = async (path: string, body?: object): Promise<Record<string, unknown>> => {
      const response = await fetch(
        `${config.origin}${path}`,
        body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      )
      requireCheck(response.ok, 'generation_metadata_unavailable')
      return (await response.json()) as Record<string, unknown>
    }
    const identity = async () => {
      const tags = (await metadata('/api/tags')) as {
        models?: { name: string; digest: string; size: number }[]
      }
      const tag = tags.models?.find(
        (item) => item.name === config.model || item.name === `${config.model}:latest`,
      )
      requireCheck(tag?.digest === config.digest, 'generation_manifest_mismatch')
      requireCheck(
        tag !== undefined && tag.size > 0 && tag.size <= GiB,
        'generation_asset_over_1GiB_or_unknown',
      )
      return tag
    }
    const before = await identity()
    const version = await metadata('/api/version')
    const show = (await metadata('/api/show', { model: config.model })) as GenerationMetadata
    const context = validateGenerationMetadata(show)
    report.generation = {
      model: config.model,
      digest: config.digest,
      asset: before,
      version,
      details: show.details,
      configuredContext: context,
      maxOutputTokens: config.outputTokens,
      atomicDigestPin: false,
      runtimeRss: 'not_measured',
      cpuConfigured: true,
    }
    report.stage = 'disposable_database'
    database = await openTestDatabase(
      config.databaseUrl,
      `generation_${crypto.randomUUID().replaceAll('-', '')}`,
    )
    requireCheck(database, 'disposable_postgres_unavailable')
    if (!database) throw new Error('disposable_postgres_unavailable')
    await runMigrations(database.pool)
    const embedding = new LocalEmbeddingAdapter({
      baseUrl: config.embeddingOrigin,
      model: 'all-minilm:22m',
      revision: '1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef',
      dimensions: 384,
      maxInputTokens: 256,
    })
    report.embedding = embedding.profile
    const retrieval = new PostgresRetrieval(database.pool, {
      embedding,
      chunkMaxTokens: 192,
      chunkOverlapTokens: 32,
    })
    const realConductor = new OpenAiCompatibleConductor({
      baseUrl: `${config.origin}/v1`,
      modelAlias: config.model,
      maxOutputTokens: config.outputTokens,
      temperature: 0,
    })
    const realEvaluator = new StructuredEvaluator({
      localBaseUrl: `${config.origin}/v1`,
      modelAlias: config.model,
      maxOutputTokens: config.outputTokens,
    })
    let currentContext: RepositoryContext | undefined
    let sharedContext = false
    const invocations: InvocationRecord[] = []
    const schemas: object[] = []
    const conductorOutputs: { kind: 'brief' | 'question'; text: string }[] = []
    report.invocations = invocations
    report.tokenAccounting =
      'Production adapter records; missing provider usage may be represented as zero, not measured zero tokens.'
    report.evaluatorResponses = schemas
    // Observers delegate exactly once to production adapters. No canned or repaired response.
    const conductor: ConductorPort = {
      async renderRoundBrief(input) {
        const result = await realConductor.renderRoundBrief(input)
        conductorOutputs.push({ kind: 'brief', text: result.text })
        invocations.push(result.invocation)
        return result
      },
      async renderQuestion(input) {
        currentContext = input.artifact?.repositoryContext
        const result = await realConductor.renderQuestion(input)
        conductorOutputs.push({ kind: 'question', text: result.text })
        invocations.push(result.invocation)
        return result
      },
    }
    const evaluator: EvaluatorPort = {
      async complete(request) {
        sharedContext =
          currentContext !== undefined &&
          request.user.includes(
            asData('supporting_repository', JSON.stringify(currentContext.sources)),
          )
        const result = await realEvaluator.complete(request)
        invocations.push(result.invocation)
        schemas.push({
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          promptHash: request.promptHash,
          schemaHash: hash(JSON.stringify(request.schema)),
          requestHash: hash(request.system + request.user),
          ok: result.ok,
          ...(result.ok ? { value: result.value } : { failure: result.failure.kind }),
        })
        return result
      },
    }
    api = await testApi({
      deps: { retrieval, embeddingProfileId: embedding.profile.id, conductor, evaluator },
    })
    report.stage = 'authored_fixture'
    dir = await mkdtemp('/tmp/opencode/generation-fixture-')
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: dir!,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      }).trim()
    git('init', '-q', '-b', 'main')
    for (const [path, text] of Object.entries(GENERATION_FILES)) {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, path), text)
    }
    git('add', 'src')
    git(
      '-c',
      'user.name=Levelhead Fixture',
      '-c',
      'user.email=fixture@levelhead.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      GENERATION_FIXTURE_VERSION,
    )
    const commit = git('rev-parse', 'HEAD')
    report.fixture = {
      version: GENERATION_FIXTURE_VERSION,
      commit,
      contentHash: hash(JSON.stringify(GENERATION_FILES)),
      assertion:
        'leaseExpired reports expiry at or after the deadline; it provides no locking guarantee.',
    }
    const pin = await api.app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { repoPath: dir },
    })
    requireCheck(pin.statusCode === 201, 'fixture_pin_failed')
    const snapshotId = (pin.json() as { snapshot: { id: string } }).snapshot.id
    const results: object[] = []
    report.cases = results
    for (const example of GENERATION_CASES) {
      report.stage = `case_${example.id}`
      currentContext = undefined
      sharedContext = false
      const invocationStart = invocations.length
      const outputStart = conductorOutputs.length
      const started = await api.app.inject({
        method: 'POST',
        url: '/sessions',
        payload: {
          rounds: ['code_walkthrough'],
          mode: 'coach',
          turnsPerRound: 1,
          drill: false,
          snapshotId,
          repositorySearch: 'hybrid',
        },
      })
      requireCheck(started.statusCode === 201, 'real_question_failed')
      const start = started.json() as {
        sessionId: string
        question?: { text: string; artifact?: { repositoryContext?: RepositoryContext } }
      }
      const shown = start.question?.artifact?.repositoryContext
      requireCheck(
        shown && shown.sources.length > 0 && shown.trace.tokenCount <= 2048,
        'bounded_context_missing',
      )
      requireCheck(
        JSON.stringify(shown) === JSON.stringify(currentContext),
        'conductor_display_context_mismatch',
      )
      for (const source of shown!.sources) {
        requireCheck(
          source.commit === commit && source.path === 'src/lease.ts',
          'nonfixture_source',
        )
        const text = GENERATION_FILES['src/lease.ts']
          .split('\n')
          .slice(source.startLine - 1, source.endLine)
          .join('\n')
        requireCheck(
          source.text === text || source.text === text + '\n',
          'noncanonical_source_lines',
        )
      }
      const answered = await api.app.inject({
        method: 'POST',
        url: `/sessions/${start.sessionId}/answers`,
        payload: { text: example.answer },
      })
      requireCheck(answered.statusCode === 200, 'real_evaluation_http_failed')
      const turn = answered.json() as { stoppedBy?: string; notices: string[] }
      const events = await api.store.read(start.sessionId)
      const evaluations = events.filter((event) => event.kind === 'evaluation')
      const findings = evaluations.flatMap((event) => event.payload.findings)
      const evidence = evaluations.flatMap((event) => event.payload.evidence)
      const drops = events.filter(
        (event) => event.kind === 'observation' && event.payload.note.startsWith('finding dropped'),
      )
      const assessed = assessGeneration(findings, evidence, drops.length, example.requireAbstention)
      // Quoting an attack as evidence is not obeying it. Do not reject an exact answer quote
      // merely for containing the attack marker; schema/policy checks still apply.
      const caseOutputs = conductorOutputs.slice(outputStart)
      const noInjectedOutput = !hasObviousMarkerObedience(caseOutputs.map((output) => output.text))
      const noFalseCredit =
        example.id !== 'false-code-guarantee' ||
        findings.every((finding) => finding.kind !== 'competency' || finding.levelMet === null)
      const caseInvocations = invocations.slice(invocationStart)
      const completeOutputs =
        caseInvocations.length === 3 &&
        caseInvocations.every(
          (invocation) =>
            invocation.stopReason === 'end_turn' || invocation.stopReason === 'stop_sequence',
        )
      const passed =
        assessed.passed &&
        sharedContext &&
        noInjectedOutput &&
        noFalseCredit &&
        completeOutputs &&
        turn.stoppedBy !== 'evaluator_failure'
      results.push({
        id: example.id,
        answer: example.answer,
        question: start.question?.text,
        sources: shown!.sources,
        sharedContext,
        ...assessed,
        noInjectedOutput,
        conductorOutputs: caseOutputs,
        noFalseCredit,
        completeOutputs,
        passed,
        dropped: drops.map((event) => event.payload),
        findings,
        evidence,
        notices: turn.notices,
      })
      // Finish the fixed case list even after policy failure, but never retry a case.
    }
    report.stage = 'runtime_identity_after'
    const active = (await metadata('/api/ps')) as {
      models?: { name: string; digest: string; context_length?: number; size_vram?: number }[]
    }
    const loaded = active.models?.find((model) => model.digest === config.digest)
    requireCheck(
      loaded &&
        loaded.context_length !== undefined &&
        loaded.context_length <= 4096 &&
        loaded.size_vram === 0,
      'bounded_cpu_runtime_not_observed',
    )
    report.loadedRuntime = loaded
    report.generationAfter = await identity()
    report.completionRequests = calls.filter((call) => call.path === '/v1/chat/completions').length
    requireCheck(
      report.completionRequests === GENERATION_CASES.length * 3,
      'unexpected_completion_count',
    )
    report.stage = 'deletion'
    const deleted = await api.app.inject({ method: 'DELETE', url: `/snapshots/${snapshotId}` })
    const hits = await retrieval.search(LOCAL_OWNER_ID, snapshotId, 'leaseExpired', 3, {
      strategy: 'hybrid',
    })
    const stale = await api.app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { rounds: ['code_walkthrough'], snapshotId, repositorySearch: 'hybrid' },
    })
    const removedRows = await database.pool.query(
      `select (
        (select count(*) from artifact_index where owner_id = $1 and snapshot_id = $2) +
        (select count(*) from retrieval_chunks where owner_id = $1 and snapshot_id = $2) +
        (select count(*) from retrieval_vectors where owner_id = $1 and snapshot_id = $2) +
        (select count(*) from retrieval_publications where owner_id = $1 and snapshot_id = $2)
      )::text as remaining`,
      [LOCAL_OWNER_ID, snapshotId],
    )
    const firstSource = currentContext?.sources[0]
    const sourceRead =
      firstSource === undefined
        ? undefined
        : await api.app.inject({
            method: 'GET',
            url: `/snapshots/${snapshotId}/artifacts/${firstSource.artifactId}`,
          })
    report.deletion = {
      status: deleted.statusCode,
      remainingHits: hits.length,
      staleSessionStatus: stale.statusCode,
      remainingSourceCacheRows: removedRows.rows[0]?.remaining,
      deletedSourceStatus: sourceRead?.statusCode,
    }
    requireCheck(
      deleted.statusCode === 200 &&
        hits.length === 0 &&
        stale.statusCode === 400 &&
        removedRows.rows[0]?.remaining === '0' &&
        sourceRead?.statusCode === 404,
      'deletion_check_failed',
    )
    requireCheck(
      results.every((result) => (result as { passed: boolean }).passed),
      'real_judgment_acceptance_failed',
    )
    report.stage = 'complete'
    report.passed = true
  } finally {
    clearTimeout(deadline)
    clearInterval(monitor)
    controller.abort()
    globalThis.fetch = nativeFetch
    report.minimumSampledAvailableBytes = minAvailable
    try {
      await api?.app.close()
      report.applicationClosed = true
    } finally {
      try {
        await database?.close()
        report.ownSchemaCleaned = true
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true })
        report.ownFixtureCleaned = true
      }
    }
  }
}

if (import.meta.main) {
  // Exclusive create before preflight: dependency failures are still retained as failures.
  const destination = resolve(process.argv[2] ?? `/tmp/opencode/generation-${Date.now()}.json`)
  if (!destination.startsWith('/tmp/opencode/') || destination === '/tmp/opencode/')
    throw new Error('Report must be under /tmp/opencode')
  const file = await open(destination, 'wx', 0o600)
  const report: Record<string, unknown> = {
    version: 1,
    passed: false,
    startedAt: new Date().toISOString(),
    semanticReview: 'not_performed',
    physicalOfflineProof: false,
    scriptedEngines: false,
    completionRequests: 0,
  }
  try {
    const sourcePaths = [
      'generation.ts',
      'generation-support.ts',
      '../../../apps/cli/src/adapters/conductor-openai.ts',
      '../../../apps/cli/src/adapters/evaluator-structured.ts',
      '../../../apps/cli/src/adapters/openai-compatible.ts',
      '../../../packages/core/src/session/run.ts',
      '../../../packages/core/src/evaluation/evaluate.ts',
      '../../../packages/prompts/src/answer-evaluation.ts',
      '../../../packages/prompts/src/question-render.ts',
      '../../../packages/db/src/retrieval.ts',
    ]
    report.sourceHashes = Object.fromEntries(
      await Promise.all(
        sourcePaths.map(async (path) => [
          path,
          hash(await readFile(new URL(path, import.meta.url), 'utf8')),
        ]),
      ),
    )
    await run(report)
  } catch (error) {
    // Do not emit exception messages: DB/HTTP errors may contain credentials or source bytes.
    report.failure =
      error instanceof CheckFailure ? error.message : 'dependency_or_configuration_failure'
    report.passed = false
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString()
    await file.writeFile(JSON.stringify(report, null, 2) + '\n')
    await file.close()
    console.log(
      `Real-generation check ${report.passed ? 'passed mechanically' : 'FAILED'}: ${destination}`,
    )
  }
}
