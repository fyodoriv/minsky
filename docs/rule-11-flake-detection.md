# Rule #11 flake detection

`scripts/check-rule-11-no-flaky-gates.mjs` is the auto-detect ratchet for [rule #11](../vision.md#11-no-flaky-metric-is-a-load-bearing-claim) (no flaky metric is a load-bearing claim). It reads the trailing 100 GitHub Actions runs of a workflow, finds same-SHA failure→success pairs (Memon 2017 § 3, Google's DETECTOR primitive), and surfaces a `FlakeReport` when the per-job rate clears 10% over ≥5 same-SHA pairs.

The CI job (`rule-11-flake-detection` in `.github/workflows/ci.yml`) runs on every PR and uploads `tmp/rule-11/*-task-block.md` + `*-workflow.patch` as workflow artifacts when flakes surface. The job runs with `continue-on-error: true` — paradox-aware, since a detector that fails the build on every detection becomes itself a flaky-feeling gate.

## Anatomy of a detection

When the lint surfaces a flake, it auto-emits two artefacts per offending job:

1. **`<workflow>-<job>-task-block.md`** — a TASKS.md-shaped block draft pre-registering the flake-fix per rule #9 (Hypothesis / Pivot / Measurement / Anchor populated from the FlakeReport metadata). Paste it into TASKS.md, claim, ship.
2. **`<workflow>-<job>-workflow.patch`** — a human-readable instruction file describing the `continue-on-error: true` addition. Per the parent task's pre-registered Pivot, this is *not* a `git apply`-able unified diff (YAML formatting varies enough across workflows that a generated diff is fragile). The instruction file is robust by construction.

Operator workflow:

1. CI run completes; download the `rule-11-flake-patches` artefact from the workflow summary.
2. Read the auto-emitted task block. If you can fix the root cause in 1d, paste the block into TASKS.md and ship the fix.
3. If the root cause isn't tractable in 1d, apply the `<workflow>.patch` instructions to downgrade the gate to `continue-on-error: true`, ship the downgrade, and file a P3 follow-up to investigate.

## Canonical example: lighthouse-mobile downgrade (#125)

The lighthouse-mobile gate was the first rule-#11 enforcement event. PR #125 lowered the threshold to 0.85 and applied `continue-on-error: true` — the exact shape this lint auto-emits. That PR is the canonical "what merged work looks like" reference; future auto-emissions should converge on the same shape.

## Local invocation

```bash
# Live ingestion against this repo's `ci` workflow:
node scripts/check-rule-11-no-flaky-gates.mjs --workflows ci --emit tmp/rule-11/

# Hermetic fixture path (used by CI; same shape, deterministic input):
node scripts/check-rule-11-no-flaky-gates.mjs \
  --fixture test/fixtures/rule-11-flake-detection/flaky.json \
  --emit tmp/rule-11/
```

Exit codes:

- `0` — no flakes detected (≥10% rate over ≥5 same-SHA pairs).
- `1` — at least one report surfaced; artefacts written to `--emit <dir>`.
- `2` — bad input (neither `--fixture` nor `--workflows` provided).

## Why these thresholds

- **10% rate**: Memon 2017 § 3 calls this "the empirical mark for a gate the team learns to ignore"; *Accelerate* 2018 ch. 3 (DORA) cites the same boundary.
- **≥5 same-SHA pairs**: minimum sample size before the rate becomes predictive — a 1-in-3 coincidence at 33% rate is noise, not signal.

Both are exported as `FLAKE_RATE_THRESHOLD` and `MIN_PAIRS_FOR_REPORT` so they're inspectable and tunable.

## Pre-registration

Each of the 4 sub-tasks ships its own pre-registration record:

- `experiments/rule-11-flake-detection-pure-fn-2026-05-04.yaml` — pure decision function
- `experiments/rule-11-flake-detection-cli-2026-05-04.yaml` — CLI + `gh run list` ingestion
- `experiments/rule-11-flake-detection-patch-emit-2026-05-04.yaml` — `emitPatches` + render functions
- `experiments/rule-11-flake-detection-ci-wire-2026-05-04.yaml` — CI job + vision.md row + this doc
