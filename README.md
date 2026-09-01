# CLOSER

**An interview mentor that tells you the truth about what you built — with evidence — and trains you to stay composed when someone pushes back.**

---

## What it does

You give it one claim from your résumé. It interrogates you the way a good senior engineer would — mechanism, trade-offs, failure modes — and it applies deliberate pressure: it interrupts, it states a false premise to see if you fold, it leans on the point you were vague about.

Then it tells you the truth:

- what held up and what didn't,
- the exact thing _you said_ that gave it away,
- how confident it is — and "I can't tell from this" when it can't,
- one drill for the gap, and a retest later under different constraints.

And separately from whether you were _right_, it tells you whether you stayed _composed_.

### An illustrative exchange

_Illustrative. The shape is real — this is what a session produces — but the wording here is written for the page, not captured from a run._

> **Your résumé says:** "Built a durable job queue processing 10k jobs/day."
>
> **CLOSER:** What happens when a worker dies halfway through a job?
> **You:** It retries.
> **CLOSER:** Retries how? Who notices the worker died? _(pressure: sustained)_
> **You:** …there's a lease on the job. If it expires, another worker picks it up.
> **CLOSER:** Good. And what stops the original worker from finishing the same job when it comes back?
> **You:** I don't think we handled that.
>
> **Finding — mechanism _partially supported_.** You described lease-based recovery correctly. You did not describe how a resurrected worker is prevented from completing a job twice — your words: _"I don't think we handled that."_ Confidence: high. **Drill:** idempotent completion.
>
> **Composure — held.** You said "I don't think we handled that" instead of inventing an answer. That is the right move, and it is the trait being trained.

## How it's built

_For the technical reader; skip freely._

Two engines behind clean interfaces. A **Conductor** runs the interview — it is generative, determinism doesn't matter, and it can sit on any model, including a local one. An **Evaluator** judges — on a controlled path with strict output schemas, exact token and cost accounting, and enforced budgets, because it is the part that must be honest and measurable.

Every claim links to the exact résumé line and, later, the exact file, function, or commit in your repository. Every finding cites the exact words in your answer. The evaluator states its confidence and is allowed to abstain. Code decides _what kind_ of question comes next; the model only phrases it. Every plan, question, answer, and judgment is an append-only event, so any session replays exactly.

TypeScript on the Node.js runtime, with Bun as package manager and dev/test runner. PostgreSQL for
state, an append-only event table, full-text retrieval over pinned repository snapshots, and a
leased job table for durable background work. A Fastify API whose TypeBox schemas generate both its
OpenAPI document and the browser client, a React evidence UI where hovering a finding highlights the
exact words that produced it, and a separate worker process that parses repositories in isolation
under hard limits. Résumés and repositories are treated as untrusted input — never executed, never
allowed to instruct the model.

Every user-owned row carries an owner id and every query filters on it, from the first migration
that could have needed one, so one person's material is never visible to another. Export and
deletion are ordinary routes rather than support requests: a deleted repository snapshot leaves a
tombstone, and a later replay reads its citations as _snapshot deleted_ — neither resolved nor
broken.

## Running it

```sh
bun install
bun run smoke             # proves the loop runs end to end, with no provider and no container
bun run llama:up          # optional: a local model, so the loop costs nothing to try
bun run closer doctor

bun run closer claims fixtures/resume-sample.md   # or your own résumé
bun run closer session --rounds project_deep_dive,design_extension --turns 6
bun run closer ledger
bun run closer next       # what is due, and the rounds that would cover it
```

Set `MODEL_PROVIDER_API_KEY` to put the Evaluator — the honesty-critical half — on a stronger model.
`closer repo <path>` pins a repository so a round can interrogate the actual code; `closer transfer`
retests a drilled gap; `closer replay <id>` re-checks every citation byte-for-byte;
`closer export` hands you everything it holds about you; `closer forget` deletes a pinned snapshot;
`closer policy`, `closer roles` and `closer formats` print the machine the interview runs on.

For the browser, with the evidence UI and the durable queue:

```sh
bun run db:up && bun run db:migrate
bun run web:build
CLOSER_STORE=postgres bun run serve     # API on :3001, evidence UI at /app/
bun run worker                          # repository ingestion, exports, retention sweeps
bun run voice:up                        # optional: local speech, both models offline
```

Voice is an I/O layer over the same text engine. Pace, pauses and filler words are recorded beside
the interview and never enter a finding, the rubric, or the gap ledger — scoring delivery is the
saturated half of this market and it cannot tell whether an answer was any good.

## Who it's for

**First, the person building it.** A final-year CS student building this to fix his own interviews; it runs on his own résumé from the first week. Then friends. Then engineers preparing for backend and applied-AI roles — anyone who would rather learn the truth in practice than during the interview.

## What's honest to say today

CLOSER's whole point is honesty, so here is the unvarnished state:

- **The mentor is built and runs; the benchmark has never been run.** You can paste a résumé, be
  interrogated across rounds on your own claims, take pressure up to the false-premise level, get
  findings that quote your exact words or abstain, and watch a gap close only after it holds under
  transfer and survives retrieval later. What does not exist is a single measured number about how
  well it does any of that.
- **The honest evaluator is a goal to be measured, not a claim.** A benchmark exists precisely to prove or disprove it. Until it runs there are no numbers, and none go on a résumé.
- **Results will be auditable, not regenerable.** Hosted models offer no seed and cannot be version-pinned, so CLOSER publishes full transcripts, prompt hashes, and repeated-run variance rather than pretending a single number reproduces.
- **It cannot detect lying, authorship, personality, or emotion**, and it will never output a "readiness score." Repository evidence shows what deserves a question; it does not prove who wrote the code.
- **The labelled dataset is empty.** The tool that builds it exists; nobody has labelled anything.
  The agreement gate is pre-declared not to fire below 100 labelled claims — below that the number
  ships with its interval and no pass or fail is asserted.
- **Every honesty rule is a build failure, not a promise.** Seven of them — a citation must resolve
  byte-for-byte, a finding with no evidence must not typecheck, no schema may contain an aggregate
  score, the model may never choose the next question type, abstention must be reachable, a
  compromised model must change nothing, and a session must replay byte-identically — run in CI, and
  the build fails if one breaks. An eighth now runs beside them: no delivery signal may reach a
  finding, a rubric or the gap ledger.
- **No role has been validated, and each one says so.** Role packs shape what a round expects; the
  tool prints "no agreement has been measured for this role" every time one is used, because a role
  pack is data, and data is not evidence.
- **The agent interface exists and refuses to start.** An MCP surface over the same use cases is
  built, and it is gated behind the benchmark beating a baseline over real fixtures. There is no
  flag that opens it: run the benchmark, publish the report, and it starts on its own.

The stop condition is written down: if this ends up as _upload résumé → chat → score → dashboard_, it stops.

---

_Design documents, decision records, and research are kept private while the project is in development._
