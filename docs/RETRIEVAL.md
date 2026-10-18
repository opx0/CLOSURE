# Commit-pinned repository search

Repository search is separate from the learning activity named Retrieval. It supplies bounded,
cited code to a walkthrough; it does not select interview subjects or establish competence.
Ingestion remains parse-only. PostgreSQL stores English full-text search (FTS) chunks ranked by
`ts_rank_cd`, not BM25, and optional pgvector vectors. Dense search uses exact cosine, not an
approximate nearest-neighbor (ANN) index. Hybrid uses deterministic artifact-deduplicated
reciprocal rank fusion with constant 60, not a comparison of lexical and vector scores.

## Configuration

The CLI needs `LEVELHEAD_STORE=postgres` and an explicit `DATABASE_URL` for repository search.
The server and worker also need `DATABASE_URL`. Migration 006 executes `CREATE EXTENSION IF NOT
EXISTS vector WITH SCHEMA public`; the pgvector extension files must be installed in PostgreSQL
before migration, and the migration role needs permission to create the extension. This applies
even to lexical-only use. The development Compose image includes pgvector. A fresh development
database uses `bun run db:up`, then `bun run db:migrate`. Reusing an existing volume does not
install extension files or migrate its schema automatically. Do not run migrations or evaluation
against a database whose contents you cannot safely modify.

Configure the same encoding and chunk settings in CLI, server and worker environments:

```sh
export LEVELHEAD_STORE=postgres
export LEVELHEAD_EMBEDDING_BASE_URL=http://127.0.0.1:11434
export LEVELHEAD_EMBEDDING_MODEL=all-minilm:22m
export LEVELHEAD_EMBEDDING_REVISION=sha256:1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef
export LEVELHEAD_EMBEDDING_DIMENSIONS=384
export LEVELHEAD_EMBEDDING_MAX_INPUT_TOKENS=256
export LEVELHEAD_CHUNK_MAX_TOKENS=192
export LEVELHEAD_CHUNK_OVERLAP_TOKENS=32
```

Ollama must already be running with the embedding model installed; `bun run llama:up` starts the
separate generation service, not Ollama. The adapter never downloads, falls back, or calls a hosted
embedding provider. The configuration above identifies the validated 384-dimensional artifact,
not a promise that a future download of `all-minilm:22m` resolves to this digest. A different digest
fails rather than silently updating the pin. These are provisional bounds, not measured hardware
recommendations. The encoding profile fingerprints model/digest, dimensions, input bound, tokenizer
identity, pooling, normalization, prefixes and preprocessing version. Recipe changes require
reindexing. Lexical-only indexing works without an embedding configuration; explicit dense/hybrid
requests then fail.

Generation remains separate, configured by `LLAMA_BASE_URL`, `MODEL_ID`, and optionally
`MODEL_PROVIDER_API_KEY`. A working embedding service does not establish that the Conductor or
Evaluator can run an interview. An OpenAI-compatible generation protocol does not imply use of
OpenAI's hosted service.

The current environment factory sends `local/llama.cpp` for local generation; `MODEL_ID` selects
the hosted Evaluator model when a provider key is present, not an arbitrary installed local model.
For direct adapter use, set the actual local endpoint and a `local/` model alias explicitly, and
omit the provider key. Verify the runtime artifact separately; an alias alone is not a digest pin.

OpenAI-compatible calls share a 60-second deadline signal that aborts fetch and response reading;
`postChatCompletion` accepts optional `timeoutMs` and caller `signal` request options. Retries share
the deadline and cannot start another fetch after expiry; limiter queueing/retry backoff can still
delay promise settlement. Conductor questions and round briefs send `max_tokens=512` by default;
direct adapter configuration accepts a positive integer `maxOutputTokens`. The local structured
Evaluator already sends each request's output budget and optionally caps it with its own
`maxOutputTokens` configuration; omission preserves that request budget. This optional ceiling does
not change the Anthropic path. Truncated evaluation remains an explicit failure, not an abstention.
Context allocation is runtime-owned: the standard OpenAI request here has no context-size control.
Configure and verify the local runtime's context, concurrency and memory bounds before generation;
neither output tokens nor the retrieval context budget bounds the runtime's total allocation.

## Pin, index, and select search

With `DATABASE_URL` set and the schema migrated, the CLI pins a commit and publishes its index:

```sh
bun run levelhead repo ~/code/your-project --ref HEAD
bun run levelhead session --rounds code_walkthrough --repository-search hybrid
```

The `repo` command accepts a commit hash, branch, or tag for `--ref` and resolves it to a pinned
commit. It uses `HEAD` when `--ref` is absent. It indexes lexical chunks and, when configured,
embeddings before recording the pin. There is no separate CLI reindex command. Existing snapshots
need a new indexed pin before publication-based search is available. To rebuild after a recipe or
chunk-setting change, run `repo` again with the intended commit and start a session on the new pin.
Changing only chunk size or overlap leaves the encoding profile unchanged but still requires
reindexing. Changing environment variables alone does not rebuild an existing publication.
Lower-level `index` calls replace a live snapshot's publication atomically; deleted snapshots cannot
be reindexed. CLI repinning creates a new snapshot rather than reviving a deleted one.

`--repository-search lexical` selects FTS, `dense` selects exact cosine, and `hybrid` combines both.
`LEVELHEAD_REPOSITORY_SEARCH` accepts the same three values; the CLI flag overrides it. With neither
option, the walkthrough keeps its existing non-search behavior. HTTP callers supply
`repositorySearch` and `snapshotId` to `POST /sessions`.
Synchronous HTTP pins and worker ingestion both publish the index before the public pin event.
The worker's per-job checkpoint preserves the original commit on retry, even after HEAD moves.

## Safety and limits

- Only loopback HTTP origins (`localhost`, `127.0.0.1`, or `[::1]`) are accepted, with no redirects,
  credentials, or URL paths beyond `/`.
  Explicit cloud selectors and remote host/model metadata are rejected before source inference.
  Native `/api/show` must identify a local embedding-capable artifact. Requests to `/api/show`
  and `/api/embed` use the immutable `sha256:<manifest digest>` reference; unsupported runtimes
  fail closed before inference, with no mutable-tag fallback. The validated Ollama 0.40.3
  runtime accepts this reference. Configured tag digest/locality is checked before and after
  every batch and drift rejects the entire call. This is not a claim of full atomic pinning or
  protection from a malicious local service; do not mutate model assets during a run. Use network
  isolation and disabled cloud service configuration for an independent offline boundary. The
  remaining trust boundary is the local Ollama runtime and its model assets, not the adapter alone.
- The adapter uses UTF-8 bytes plus eight special tokens as an explicitly conservative token
  upper bound, including prefixes. It does not ship a tokenizer or infer the loaded `num_ctx`.
  `all-minilm:22m` has architecture context 512 but the validated runtime configuration uses 256.
  Requests set `truncate:false`. Default batches are at most 16 inputs, with 30-second per-request
  timeout and 16 MiB maximum response. Invalid/nonfinite/zero/wrong-dimension vectors fail.
- Chunks preserve whole lines, CRLF and UTF-8, with a byte bound plus 16 framing tokens.
  A single oversized line fails explicitly rather than silently truncating it. Stable chunk IDs
  hash content, location and chunk version, excluding random artifact IDs. Cache lookup requires
  the same owner, immutable encoding recipe and stable chunk ID; rows remain snapshot-deletable.
- Publication/replacement and deletion use a held transaction and snapshot row lock. Embedding
  happens outside the lock; publication rechecks the tombstone. Failed replacement leaves the
  previous publication intact. Deletion removes artifact bodies, chunks and vector/cache rows;
  immutable profiles contain configuration only. A deleted pin cannot be republished by retry.
- Walkthrough context is capped at 2,048 conservative serialized tokens, four sources and 80
  lines per candidate. Commit/path/line/hash citations are rehydrated from pinned Git reads,
  never trusted index excerpts. Both engines and the displayed question receive the same context.
  The selected subject stays first. Availability is checked before rendering and after the answer
  and evaluation; deleted material fails explicitly. Search traces contain hashes, IDs, ranks and
  versions, not source/query text. Source quotes are verified separately from mandatory answer
  quotes; only artifact evidence references, not source bodies, enter immutable findings/events.
- Simulation feedback withholding remains unchanged. Search is refused for Transfer rather than
  exposing familiar code as an unfamiliar retest. JSONL cannot pretend to provide a durable index.
  Deletion removes Levelhead's stored copies, not the candidate's original Git repository. The
  database tombstone is authoritative before its event mirror; cross-store mirroring is not a
  distributed transaction.

## Validation and evaluation

Unit and scripted tests use `bun test`. Required native checks opt in explicitly and fail on unavailable
dependencies once selected:

```sh
# DATABASE_URL must name a disposable PostgreSQL database with vector installed.
RETRIEVAL_INTEGRATION=1 bun test packages/db/src/retrieval.integration.test.ts \
  apps/server/src/routes/snapshots.test.ts
```

Those checks use the public authored fixture and the pinned local model above. Retrieval uses
real PostgreSQL/vector/model calls; the HTTP walkthrough's Conductor/Evaluator are scripted,
not an assessment of generation or judgment quality.

Run the actual versioned authored-corpus evaluator after migrations:

```sh
export RETRIEVAL_BENCH_DATABASE_URL="$DATABASE_URL" # disposable database only
export RETRIEVAL_BENCH_EMBEDDING_MODEL=all-minilm:22m
export RETRIEVAL_BENCH_EMBEDDING_REVISION=sha256:1b226e2802dbb772b5fc32a58f103ca1804ef7501331012de126ab22f67475ef
export RETRIEVAL_BENCH_EMBEDDING_DIMENSIONS=384
export RETRIEVAL_BENCH_EMBEDDING_MAX_INPUT_TOKENS=256
bun run --cwd benchmarks retrieval --out /tmp/opencode/retrieval-report.json --mode complete --split all --k 3
```

The benchmark uses `RETRIEVAL_BENCH_*` variables, not the application's `LEVELHEAD_*` configuration.
Its endpoint variable is `RETRIEVAL_BENCH_EMBEDDING_URL`, defaulting to `http://127.0.0.1:11434`.
Query and document prefixes use `RETRIEVAL_BENCH_EMBEDDING_QUERY_PREFIX` and
`RETRIEVAL_BENCH_EMBEDDING_DOCUMENT_PREFIX`, both empty by default. Set the input bound explicitly
as above: the standalone adapter and benchmark default to 512, while application configuration
defaults to 256. The adapter does not discover the runtime context limit.

Reports are exclusive-create files under `/tmp/opencode`; choose a fresh filename per run.
`--split tuning|heldout` separates authored query families. Complete mode executes the two existing
heuristics and actual FTS/dense/hybrid on one corpus, with no fake vectors. `--mode lexical-only`
is explicitly incomplete. Reports include code/corpus/label hashes, profile, per-query failures,
P@k (fixed k denominator), recall, MRR, graded nDCG, no-answer false hits, timings, conservative
token input bounds and benchmark-process resources. Model/DB process resources and actual token
usage are unobserved, not zero. Fixture owners and snapshots are isolated. Cleanup removes fixture
source and cache rows in `finally`; tombstones and immutable configuration profiles may remain.

The versioned corpus has 14 authored artifacts and 18 queries, with six tuning and 12 held-out
queries. These are implementation fixtures, not personal data or an empirical dataset. Held-out
query families are reserved from tuning, not independently collected or human-validated.

The 18 October 2026 complete run used PostgreSQL 18.6, pgvector 0.8.7, and the pinned local model
above. At k=3, both dense and hybrid returned false hits on both held-out no-answer queries:
two hits for `auth-unanswerable` and one for `ledger-unanswerable`. Dense top-k is not an abstention
mechanism; unrelated queries can return neighbors. This limitation remains visible even when
answerable-query recall is high. No current semantic-quality guarantee or hybrid-superiority
claim follows from these fixtures.

Retrieval metrics measure ranking against authored labels. Citation validity checks whether a
reference resolves to exact pinned lines. Neither establishes that those lines semantically
support a finding, nor that the candidate understands or authored the code.

Real local embedding and PostgreSQL checks are separate from scripted application and browser
checks. Scripted Conductor and Evaluator responses do not validate generation or judgment quality.
Independent human review, personal-corpus effectiveness, evaluator calibration, and a complete
offline interview workflow remain unproven. No learning-outcome result follows from this run.

### Opt-in real generation diagnostic

Unlike the scripted HTTP integration above, this command uses the production Conductor and
structured Evaluator, actual PostgreSQL hybrid search and the pinned local embedding adapter.
It never substitutes scripted engines, repairs an output or retries a judgment. It creates only a
public authored Git fixture and an isolated disposable database schema, and removes both in
`finally`. It does not start services, download models, unload models or touch existing volumes.

Prepare a **dedicated** loopback Ollama completion runtime, separate from the embedding daemon.
Use a fitting local quantized artifact of at most 1 GiB, an explicit `local/` alias, and model
parameters `num_ctx 4096` (or smaller) and `num_gpu 0`, visible in `/api/show`. Independently configure
runtime concurrency, allocation limits and an own-process watchdog before use. The diagnostic
checks alias/manifest digest before and after; this is **not atomic generation digest pinning**.
Its host-memory sampler cancels HTTP work below 1.5 GiB available; it cannot enforce runtime RSS,
unload a caller-owned model or stop a daemon continuing computation after cancellation. Linux
`MemAvailable` must be at least 3 GiB at startup. Neither swap nor free GPU memory substitutes.

```sh
export RETRIEVAL_GENERATION=1
export RETRIEVAL_GENERATION_DISPOSABLE_DB=yes
export RETRIEVAL_GENERATION_DATABASE_URL='postgres://USER:PASSWORD@127.0.0.1:PORT/DISPOSABLE_DB'
export RETRIEVAL_GENERATION_ORIGIN=http://127.0.0.1:18462
export RETRIEVAL_GENERATION_MODEL=local/YOUR_PREPARED_ALIAS
export RETRIEVAL_GENERATION_DIGEST=FULL_64_CHARACTER_MANIFEST_SHA256
# Optional: 128–1024, default 512. Truncation is a failure, never abstention.
export RETRIEVAL_GENERATION_MAX_OUTPUT_TOKENS=512
bun run --cwd benchmarks retrieval:generation /tmp/opencode/generation-report-UNIQUE.json
```

The embedding origin uses `LEVELHEAD_EMBEDDING_BASE_URL`, default `http://127.0.0.1:11434`;
its model/digest/dimension/input bounds are the validated all-minilm profile above. The database
URL must be loopback and explicitly disposable: migrations require installed pgvector and may
create its extension. A schema is dropped only after this run creates it. Do not point at valuable
data. Provider keys and application `MODEL_ID` are not read by these directly constructed adapters.

The fixed fresh diagnostics exercise an explained comparison, a false locking/exactly-once claim,
unknown deployment configuration, and repository/answer injection. They do not change the ranking
benchmark's tuning/held-out cases or invent a similarity threshold for abstention. Each case runs
once. An answer-and-source-cited finding and an explicit answer-cited abstention are reported
separately; an empty list, dropped judgment, malformed/truncated response or dependency failure
exits nonzero, never passes as abstention. The unknown-deployment case requires abstention; the
false-code case refuses positive competency credit. These authored checks are not calibration.

The exclusive-create, mode-0600 JSON report includes code/fixture hashes, runtime/model identity,
prompt versions/hashes, token usage, sampled host headroom, exact public fixture sources, structured
responses, accepted findings and deletion checks. Only public fixture inputs are sent; do not
replace them with personal material. Errors omit upstream messages/credentials. The fetch guard
allows only the two configured origins, refuses redirects, and cancels HTTP work after 180 seconds
(each request also has a 60-second bound). This is not an OS network sandbox or a hard bound on
database/cleanup settlement. Runtime RSS, semantic citation support, human review, microphone use
and physical offline operation remain unmeasured. A mechanical pass establishes none of those.
