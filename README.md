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

_Illustrative — nothing is built yet. This is the target, shown so the idea is concrete._

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

TypeScript on the Node.js runtime, with Bun as package manager and dev/test runner. PostgreSQL for state, events, and retrieval. Résumés and repositories are treated as untrusted input — never executed, never allowed to instruct the model.

## Who it's for

**First, the person building it.** A final-year CS student building this to fix his own interviews; it runs on his own résumé from the first week. Then friends. Then engineers preparing for backend and applied-AI roles — anyone who would rather learn the truth in practice than during the interview.

## What's honest to say today

CLOSER's whole point is honesty, so here is the unvarnished state:

- **Nothing is built yet.** The design is decided and written down; the code is not.
- **The honest evaluator is a goal to be measured, not a claim.** A benchmark exists precisely to prove or disprove it. Until it runs there are no numbers, and none go on a résumé.
- **Results will be auditable, not regenerable.** Hosted models offer no seed and cannot be version-pinned, so CLOSER publishes full transcripts, prompt hashes, and repeated-run variance rather than pretending a single number reproduces.
- **It cannot detect lying, authorship, personality, or emotion**, and it will never output a "readiness score." Repository evidence shows what deserves a question; it does not prove who wrote the code.
- **The first labeled dataset is small** — too few claims for a tight agreement claim. It will be reported as a point estimate with an honest interval, and grown.

The stop condition is written down: if this ends up as _upload résumé → chat → score → dashboard_, it stops.

---

_Design documents, decision records, and research are kept private while the project is in development._
