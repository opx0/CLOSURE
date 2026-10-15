# Structural invariants — where each one is actually enforced

`docs/wayfinder/issues/05-rigor-bar.md` §3 lists seven invariants. They are **build failures, not
scores**: zero tolerance, no interval, no threshold, no partial credit. Relaxing one rather than
meeting it fires the stop condition in §8(c) — it is not a configuration change.

This file exists so nobody has to take that on trust. Each row says where the check lives and, just
as importantly, what the check does **not** cover.

> Tests under `tests/**` sit outside the workspace packages and cannot resolve `@levelhead/*`. Anything
> an invariant needs from core therefore lives under `apps/cli/src/testing/`, which is why four of
> the seven are enforced from there rather than from this directory.

| #   | Invariant                        | Enforced by                                                                                                                                                                                                                                                                                                       | What it does not cover                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Span validity = 1.00**         | `packages/core/src/events/sources.ts` (`resolveSpan`, `spanViolations`) — byte offsets, no guessing; `packages/core/src/events/sources.test.ts`; `apps/cli/src/testing/harness.ts` (`citationFailures`) used by invariants 6 and 7; `apps/cli/src/commands/replay.ts` and `ledger.ts` re-check every span on read | No sweep over stored logs on disk. A span is checked when a session is run, replayed or laid out — not by a standing job over the event store.                                                                                                                                                                        |
| 2   | **No finding without evidence**  | `packages/contracts/src/finding.ts` — `WithCitations<T>` makes `transcriptSpanIds` / `evidenceIds` non-empty **tuples**, so the empty case does not typecheck; `minItems: 1` is the runtime half; `packages/core/src/evaluation/evaluate.test.ts`                                                                 | Unrepresentability is enforced by `tsc`, so `bun run typecheck` is part of this invariant. Running only `bun test` does not check it: Bun strips types.                                                                                                                                                               |
| 3   | **No aggregate score exists**    | `tests/invariants/no-aggregate-score.test.ts` — greps every non-test source file under `apps/` and `packages/`; `apps/cli/src/testing/harness.ts` (`aggregateScoreKeys`) walks every key of every event payload at runtime, asserted in invariant 6                                                               | The grep is name-based. A field spelled to evade it (`compositeReadiness`, `blendedIndex`) passes; the runtime walk catches it only if it reaches an event.                                                                                                                                                           |
| 4   | **Policy action chosen by code** | `packages/core/src/ports/conductor.ts` — `RenderedQuestion` carries `text` and `invocation` only; `apps/cli/src/adapters/conductor-openai.test.ts` asserts the shape against a live-ish adapter; `apps/cli/src/testing/invariant-injection.test.ts` pairs every `policy_action` with the `plan` that preceded it  | Asserted on the Conductor's output and on the log. A future port that returns an action would fail the adapter test; a _second_ policy living outside `selectAction` would not be caught by either.                                                                                                                   |
| 5   | **Abstention reachable**         | `apps/cli/src/testing/invariant-abstention.test.ts` over the seeded set in `apps/cli/src/testing/insufficient-evidence.ts` — six answers that genuinely cannot be judged, plus a negative control that makes the rate > 0 assertion non-trivial                                                                   | The evaluator is scripted, so the rate measured here is a property of the script. Whether a **real** model abstains on these seeds is a benchmark measurement (§5: risk–coverage, AURC, accuracy at 70% and 85% coverage), and no number in this test may be reported as that.                                        |
| 6   | **Injection success = 0**        | `apps/cli/src/testing/invariant-injection.test.ts` over `fixtures/resume-injection.md`, driven by the fully compromised model in `apps/cli/src/testing/hostile.ts`                                                                                                                                                | Proves the _system_ holds when the model has already surrendered. Says nothing about whether a real model resists the prompt — that is a rate over a fixture set, per model and per prompt version, published with the run (§4, §7).                                                                                  |
| 7   | **Replay identity**              | `apps/cli/src/testing/invariant-replay-identity.test.ts` — a session is run, its log kept, and re-run through `apps/cli/src/testing/recorded.ts`, ports that return the log's own recorded outputs; findings, spans, evidence and the full event log compare byte-for-byte                                        | Holds _because_ the clock and id source are injected (`packages/core/src/ports/clock.ts`) and both runs get the same seed. It is the "auditable" half of §1's redefinition of reproducibility; repeated-run variance against a real provider (ADR-024, ticket 15) is the other half and is a measurement, not a test. |

## An eighth, added September 10, 2026

`PROJECT.md` §7 and §10 stage 8 say voice reports observable pace, pauses and filler words only, and
that those observations stay "entirely separate from competence". That separation fails the same way
an aggregate score does — by accident, when someone folds a delivery number into a finding to make a
card look complete — so it is checked the same way.

| #   | Invariant                        | Enforced by                                                                                                                                                                                                                                                                                                                                                  | What it does not cover                                                                                                                                    |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **Delivery is never competence** | `tests/invariants/delivery-is-not-competence.test.ts` — the finding contract may not mention a delivery signal, and no delivery signal may be read in `evaluation/`, `gaps/` or `policy/`; `DeliveryReport` carries its own boundary as a value; `apps/server/src/routes/delivery.test.ts` asserts that recording delivery changes neither findings nor gaps | Name-based, like invariant 3. A delivery signal spelled to evade the pattern would pass, and nothing stops a _human_ reading a pace number as a judgment. |

## Two more, added September 22, 2026 with the performance lane

The performance lane turns the recruiter-side instrument stack inward: it measures how an answer was
delivered, far more thoroughly than the three original delivery numbers. That is exactly the moment
two promises get cheap to break, so each becomes a check.

| #   | Invariant                               | Enforced by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | What it does not cover                                                                                                                                                    |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **No affect inference**                 | `tests/invariants/no-affect-inference.test.ts` — a comment-stripped grep over every `.ts`/`.tsx` under `apps/` and `packages/`, and over `voice/*.py`, bans emotion, mood, stress, arousal, engagement, deception, personality, blink rate and micro-expression. It also pins the signal registry: `gaze_on_camera_ratio` and `interruption_recovery_time` are present, `blink_rate`, `stress_level` and `confidence_level` are absent, so a new measured signal cannot be slipped in without this file noticing. | Name-based, like invariants 3 and 8. A signal spelled to evade the pattern would pass, and nothing stops a human reading a pitch number as a mood.                        |
| 10  | **No raw biometric leaves the browser** | `apps/cli/src/testing/invariant-no-raw-biometrics.test.ts` — walks `KinematicsReportSchema` and asserts every leaf is a number, so a per-frame landmark series cannot be added to make a chart nicer; asserts `ProsodyReportSchema` carries timings but no audio; and greps `packages/contracts/src` and `apps/server/src` for `landmark`, `faceMesh`, `videoFrame`, `imageBytes` and the like.                                                                                                                   | The kinematics summariser runs in the browser, which no Node test exercises; the schema walk proves the _shape_ that crosses the wire, not the capture code's discipline. |

The performance-lane half of invariant 8 (delivery is never competence) is enforced by the extended
`tests/invariants/delivery-is-not-competence.test.ts`: the finding contract names no performance
type, no performance type is read in `evaluation/`, `gaps/` or `policy/`, the debrief's two lanes are
computed by two modules that name no type in common, and the screen mirror never reaches a judgment
path.

## Still only a claim

- **§3 calls each of these "a CI check", and now they are one.** `.github/workflows/ci.yml` runs
  `bun run typecheck`, `bun run lint`, `bun run format:check` and `bun test` on every push to `main`
  and every pull request. `typecheck` is load-bearing rather than tidy: invariant 2 is enforced by a
  tuple type, and Bun strips types, so `bun test` alone would not check it.
- **Invariants 5 and 6 have a measured twin that does not exist yet.** The abstention rate and the
  injection success rate of a real model are benchmark numbers. The tests here establish that the
  machinery can carry the honest answer; they cannot establish what the honest answer is.
- **Invariant 1 is checked on the paths that read a session, not over the store.** A log that was
  written and never read again is unverified.

## Running them

```
bun test tests/invariants apps/cli/src/testing
bun run typecheck    # invariant 2 lives here, not in bun test
```
