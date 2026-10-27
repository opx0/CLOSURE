# Independent feedback review

The cases in `cases.json` are synthetic. Their reference judgments were written by an agent and have not been independently reviewed. They are regression examples, not evidence of evaluator accuracy.

Generate one split at a time with `bun run review:packet tuning` or `bun run review:packet heldout`. The packet omits the existing judgments and reasons. Treat the held-out packet as restricted evaluation material; do not use it to tune prompts or models.

For each case, independently record the case ID, reviewer identifier, date, judgment, exact supporting answer spans, uncertainty and rationale. Use the source only when provided; missing or deleted source is not permission to infer its contents. A blank answer or insufficient evidence can require abstention. Record disagreements rather than forcing consensus. Keep separate copies from each reviewer, and disclose their qualifications, independence, procedure and any conflicts.

Each reviewer may save one JSON object per line in a private file, using `id`, `reviewer`, `date` (YYYY-MM-DD), `judgment` (`supported`, `partial`, `incorrect`, or `abstain`), `quotes` (exact final-answer strings), and `rationale`. Add uncertainty to the rationale. Run `bun run review:validate tuning path/to/review.jsonl` (or `heldout`) to check structure, split membership and quotes. This does not verify identity, qualifications, independence or correctness. Keep reviewer records outside the repository unless separately authorized.

After independent review, compare records with the agent-authored references and document any adjudication. Do not count missing reviews as agreement, claim inter-rater reliability without actual ratings, or report model accuracy from these examples alone. The existing benchmark labeling and metric contracts in `benchmarks/src/labels.ts` and `benchmarks/src/metrics.ts` describe supported study inputs; this packet is not a completed study or a substitute for a representative human-reviewed evaluation.
