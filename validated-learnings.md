# Validated learnings

Append-only log of experiments whose post-merge replay (rule #9 weekly–monthly layer)
found the predicted gain held at +7d / +30d. Maintained by `scripts/replay-experiment.mjs`
and the `experiment-tracker` GitHub Actions workflow. Rows are never deleted; superseded
learnings get a follow-up row, not a rewrite.

- `rule-9-iron-rule` — validated at +0d (2026-05-03, ref f87aeac, PR #9): constitutional rule #9 (pre-registered hypothesis-driven development) is iron — every change declares Hypothesis / Success / Pivot / Measurement / Anchor *before* code. Subsequent rule-#9 substrate (`@minsky/experiment-record`, `ci-experiment-runner-v0`, this tracker) all build on this baseline. The first validated learning is the discipline itself; future replays add quantitative entries against measurements declared in `EXPERIMENT.yaml`.
