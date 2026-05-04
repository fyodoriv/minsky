# Experiment runner — rule #9 daily layer

This document describes the per-PR experiment runner that mechanically enforces constitutional rule #9 (pre-registered hypothesis-driven development) at the daily timescale. The weekly–monthly layer (`experiment-tracker-v0`) and the quarterly layer (`mape-k-loop-v0`) are described elsewhere; this file is about what every PR must carry and what CI does with it.

## Why this file exists

Rule #9 declares pre-registration; without execution, declaration is half a rule. The runner closes the loop by (a) gating every PR on a parseable `EXPERIMENT.yaml` whose `measurement` command is actually runnable, and (b) re-running that measurement on both the merge-base and current main after merge, recording both numbers tagged with the experiment id. This is the deterministic substrate rule #10 demands.

## Writing an `EXPERIMENT.yaml`

Place a single `EXPERIMENT.yaml` at the **root** of your branch. The format is defined by [`@minsky/experiment-record`](../novel/experiment-record/spec.md); the required fields are exactly the rule-#9 contract:

```yaml
id: my-experiment
hypothesis: |
  A falsifiable prediction: which observable will move, by how much, why.
  At least 20 characters.
success: "≥X units; numeric or rubric threshold"
pivot: "<Y units; below which the *approach* is abandoned, not just the change reverted"
measurement: "exact runnable shell / OTEL / CI command — no English"
anchor: "literature citation justifying the metric"
replay_windows_days: [7, 30]   # optional; default is [7, 30]
timeout_seconds: 60            # optional; default is 60
```

Notes:

- `id` is kebab-case and matches your task id (so the experiment store correlates with `TASKS.md`).
- `measurement` MUST be a single shell command that exits 0 on success. Tests, linters, OTEL queries, and `gh` invocations all qualify; English instructions do not.
- `timeout_seconds` is an integer in `[1, 3600]`. The default 60 seconds suits unit-test-shaped measurements; raise it for legitimately heavier measurements (e.g., integration suites).
- Vanity-metric phrases (`lines of code`, `commits made`, `hours spent`, `tasks in flight`, …) are rejected at parse time.

## What the gate checks

The `gate` job in `.github/workflows/experiment.yml` runs on every `pull_request` event. It:

1. **Detects the trivial exemption** (see below). If exempt → exits 0 (no further checks).
2. **Verifies `EXPERIMENT.yaml` is present** at the repo root. Missing → exit 1.
3. **Parses + validates** the file via `pnpm exec experiment-record validate EXPERIMENT.yaml` (canonical CLI from the `@minsky/experiment-record` package). Any parse error → exit 1.
4. **Executes the `measurement` command** with a wall-clock timeout of `timeout_seconds`. Non-zero exit OR timeout → exit 1.

The gate enforces only the **structural** test ("the command is runnable and produces some output"). Verdict-against-thresholds (`success` vs observed value) is the weekly layer's job — that's `experiment-tracker-v0`.

## What the recorder writes

The `record` job runs on every `push` to `main` (i.e., after a merge). It:

1. Computes `base = HEAD~1` (the prior main commit) and `head = HEAD` (the just-merged commit). For squash-merges and merge-commits with linear history, `HEAD~1` IS the merge-base.
2. Skips if the commit message contains `[skip ci]` (so the recorder's own commits don't trigger recursive runs).
3. Checks out the base ref, runs `measurement` → captures stdout as **baseline**.
4. Checks out the head ref, runs `measurement` → captures stdout as **treatment**.
5. Appends one JSONL line to `experiment-store/<id>.jsonl`:

   ```json
   {
     "experiment_id": "my-experiment",
     "baseline": "<verbatim stdout from base ref>",
     "treatment": "<verbatim stdout from head ref>",
     "ts": "2026-05-03T12:00:00.000Z",
     "ref": "<head sha>",
     "base_ref": "<base sha>",
     "baseline_duration_ms": 50,
     "treatment_duration_ms": 60
   }
   ```

6. Commits the change back to `main` with the message `chore(experiment-store): record run for <sha> [skip ci]` and pushes.

The `[skip ci]` marker prevents the recorder's own push from re-triggering the workflow.

## Trivial-PR exemption (two-factor)

A PR can skip the gate iff **both** of the following are true (matching the rule-3 deferral pattern — never one factor alone):

1. The PR carries the GitHub label `trivial`, AND
2. The PR body contains the comment `<!-- experiment: trivial — see exemption.md -->`.

Either factor alone is rejected with an explanatory error. The label says "the author intended this as trivial"; the comment says "the runner should respect that intent". Two-factor like the existing rule-3 deferral.

For trivial PRs: the gate is skipped; the recorder is a no-op (no `EXPERIMENT.yaml` to read after merge).

## Pivot threshold for THIS gate

Per rule #9, the gate itself has a pivot threshold: if it produces ≥3 false positives in its first month (e.g., misclassifying a trivial change as non-trivial, or measurement commands that pass locally but fail in CI), tighten the trivial-detection heuristic OR drop the executability gate to soft-fail until the friction subsides.

## Failure modes & chaos verification

Per constitutional rule #7.

- **Steady-state hypothesis**: every non-trivial PR's `measurement` command exits 0 within `timeout_seconds` against both base and head refs; the experiment store accumulates one line per merged non-trivial PR.
- **Blast radius**: a single CI run; the runner's failure does not block other CI jobs (those live in `ci.yml`).
- **Operator escape hatch**: the `trivial` label + exemption comment skips the gate; an admin can also disable the workflow file from the GitHub Actions UI.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Missing `EXPERIMENT.yaml` on a non-trivial PR | rule-#9 violation by author | `loud-crash-supervisor-restart` — gate exits 1 with a pointer to this doc | `scripts/run-experiment.test.mjs` case (b) |
| 2 | Malformed YAML | upstream-malformed | `loud-crash-supervisor-restart` — gate exits 1 with the parse error | case (c) |
| 3 | `measurement` is not runnable (exit ≠ 0) | rule-#9 violation by author / CI environment drift | `loud-crash-supervisor-restart` — gate exits 1 with the captured stderr | case (d) |
| 4 | `measurement` exceeds `timeout_seconds` | runaway measurement | `loud-crash-supervisor-restart` — gate exits 1 with timeout message | case (f) |
| 5 | Trivial label without exemption comment (or vice versa) | partial exemption | `loud-crash-supervisor-restart` — gate exits 1 explaining two-factor | tests "trivial label without exemption comment" / "exemption comment without trivial label" |
| 6 | Recorder's own push triggers a workflow run | CI loop | `circuit-break-and-notify` — `[skip ci]` marker on the recorder's commit message breaks the loop deterministically | manual: inspect commit history after first merge |
| 7 | Post-merge `EXPERIMENT.yaml` missing (e.g., trivial PR merged) | benign | `graceful-degrade` — record job is a no-op; emits one info line | observed at first trivial merge |

## Implementation notes

- The pure decision function is `runExperiment(...)` in `scripts/run-experiment.mjs`. It is referentially transparent: same input → same output. Tests (`scripts/run-experiment.test.mjs`) inject an `exec` stub; no test shells out for real.
- The CLI wrapper in the same file owns I/O: reads `EXPERIMENT.yaml`, runs `git checkout` between baseline and treatment, appends to the JSONL, and pushes back to `main`.
- The `@minsky/experiment-record` parser is the single source of truth for the format. The runner imports `parse` from the published package (built by `pnpm --filter @minsky/experiment-record build` in CI); vitest tests use the source-alias path (no pre-build needed).
