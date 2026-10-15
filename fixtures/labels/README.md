# Labelled set

One JSON object per line in `claims.jsonl`, appended by `levelhead label` and hand-editable.

This is the set the agreement statistic runs over. Three things about it are not negotiable, and all
three come from `docs/wayfinder/issues/05-rigor-bar.md` §6:

- **The labeller is disclosed in every report.** GRRAS asks for rater count, coefficient choice and
  adjudication procedure. A solo self-labeller is a real limitation and is stated, not glossed.
- **The flagship agreement gate does not fire below n = 100.** Below that, alpha ships with its
  bootstrap interval and no pass or fail is asserted — no "substantial", no "the evaluator works".
- **The self-use bar operates at n = 30–50 and is explicitly not a claim about the world.** Nothing
  measured under it belongs in a README, a résumé, or a benchmark table.

`levelhead label` shows the claim and the candidate's exact words _before_ the model's verdict, on
purpose: reading the model's answer first turns a labelled set into a record of the labeller
agreeing with the model, which measures nothing.
