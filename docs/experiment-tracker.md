# Experiment tracker — rule #9 weekly–monthly layer

This document describes the scheduled tracker that closes the weekly–monthly layer of constitutional rule #9 (pre-registered hypothesis-driven development). The daily layer (`ci-experiment-runner-v0`, in `docs/experiment-runner.md`) records baseline + treatment per merged PR; the quarterly layer (`mape-k-loop-v0`'s Knowledge phase) is described elsewhere. This file is about what happens in between — the +7d / +30d sustained-gain check.

## Why this file exists

Rule #9 declares pre-registration; the daily layer records observations; without re-measurement at a longer horizon, "validated learning" (Ries 2011) collapses into "the change merged and we never looked again". The 7-day floor catches novelty effects (Kohavi/Tang/Xu 2020 ch. 5); the 30-day window catches mid-term regressions that disappear from short A/B windows (ch. 7). Together they form the Analyze phase of MAPE-K (Kephart & Chess 2003) scoped to rule #9.

## Inputs

The tracker reads, per tick:

- Every `experiment-store/<id>.jsonl` (one file per experiment id; written by the daily recorder).
- The current `EXPERIMENT.yaml` at repo root (parsed via `@minsky/experiment-record`) to recover the live `measurement`, `success`, `pivot`, and `replay_windows_days` for the experiment id matching the most recent record line. If no live yaml matches, the tracker emits a warning and skips the file (closed or renamed experiments do not crash the run).
- `now` (defaults to wall-clock; overridable via `--now <iso-ts>` for deterministic testing / replay).

## Outputs

- Append a `replay-result` JSONL line to `experiment-store/<id>.jsonl` whenever a replay window's boundary is past *and* no `replay-result` for `(ref, window_days)` already exists. Idempotent: re-running the tracker on already-resolved windows is a no-op.
- On `validated`, append one line to `validated-learnings.md`.
- On `regressed`, append a `pivot-experiment-<id>` task block to `TASKS.md` at P0/P1.

## Verdict logic

The pure function `replayExperiment({ meta, record, priorReplays, currentValueStdout, now, ref, windowDays })` returns `{ verdict, reason, resultLine }` per replay window:

| condition | verdict | rationale |
|-----------|---------|-----------|
| measurement stdout has no numeric token | `inconclusive` | extractor returned `null`; nothing to compare. |
| `success` or `pivot` string has no numerically-extractable threshold | `inconclusive` | the experiment's thresholds are descriptive, not numeric; only deterministic extractor patterns (`≥N`, `>=N`, `at least N`, `≤N`, `<=N`, `at most N`, `>N`, `<N`) are honoured. |
| value crosses pivot AND a prior replay also crossed pivot | `regressed` | two-consecutive-windows rule per the Risk mitigation in `experiment-tracker-v0`'s task brief — single-window crossings stay inconclusive to dampen flake. |
| value crosses pivot for the first time | `inconclusive` | "awaiting next window before declaring regressed". |
| value meets success threshold | `validated` | sustained-gain check holds at this window. |
| value below success, above pivot | `inconclusive` | "below success, above pivot — wait for the next window or accept the experiment as a non-mover". |

The pivot task is opened *only* on `regressed` — never on a single `inconclusive` line, never on a value-just-below-success.

## Re-running locally

```sh
# Inspect what would happen without writing anything:
node scripts/replay-experiment.mjs --dry-run

# Force a specific "now" (e.g., to replay against fixtures in tests):
node scripts/replay-experiment.mjs --now 2026-06-01T00:00:00Z

# Help:
node scripts/replay-experiment.mjs --help
```

Tests pin the pure function:

```sh
pnpm vitest run scripts/replay-experiment.test.mjs
```

## Pivot threshold for THIS tracker

Per rule #9, the tracker itself has a pivot threshold: if 90 days post-landing every replay verdict is `inconclusive` (signal-to-noise too low at the 7d/30d windows), shorten the windows AND raise pre-declared success margins, OR gate eligibility by tag. If still inconclusive at 180 days, the daily-layer measurements are too noisy to support the weekly layer; pivot to declaration-only with quarterly batch review.

## Failure modes & chaos verification

Per constitutional rule #7.

- **Steady-state hypothesis**: every tick, the tracker either appends new replay-result lines (when a window's boundary has been crossed) or is a no-op (when nothing is due); the experiment-store grows monotonically; corrupt JSONL never crashes the run.
- **Blast radius**: a single CI run; the tracker's failure does not block other workflows. A bad commit-back is reverted by hand from main; the worst-case observable is a missed daily replay.
- **Operator escape hatch**: disable the workflow file from the GitHub Actions UI; the tracker is fully passive otherwise (no daemons, no long-running state).

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Corrupt JSONL line in `experiment-store/<id>.jsonl` | upstream-malformed (e.g., a manual edit, a power-loss mid-write) | `graceful-degrade` — surface a warning, skip the bad line, continue processing | `scripts/replay-experiment.test.mjs` `parseJsonl — graceful-degrade on corrupt rows` cases |
| 2 | Live `EXPERIMENT.yaml` no longer matches the experiment id in the record | experiment closed or renamed | `graceful-degrade` — emit warning, skip the file (no crash, no false verdict) | covered by `loadMetaFor` returning `null` path; observed in normal operation when an experiment id is retired |
| 3 | `measurement` command exits non-zero or times out during replay | runaway / broken measurement (env drift) | `graceful-degrade` — warning logged, window not advanced; the next tick retries | covered by `runOneWindow`'s exit-code branch (the runner does not crash) |
| 4 | First-time pivot crossing (single-window regression) | flake or genuine regression | `inconclusive` — wait for next window before opening a pivot task | `replayExperiment — verdict ladder` case "first pivot crossing → inconclusive (must persist)" |
| 5 | Two consecutive pivot crossings | sustained regression | `loud-crash-supervisor-restart`-equivalent at the *task* layer — open a `pivot-experiment-<id>` task in TASKS.md | `replayExperiment — verdict ladder` case (b) "regressed: two consecutive" |
| 6 | Recorder's own commit triggers a workflow run | CI loop | `circuit-break-and-notify` — `[skip ci]` marker on the recorder's commit message breaks the loop deterministically | manual: inspect commit history after first scheduled run |
| 7 | Re-running tracker on already-resolved windows | accidental double-trigger | `graceful-degrade` — `dueWindows` returns `[]`, no new rows written | `dueWindows — idempotence + scheduling` case (d) "already-resolved windows is a no-op" |
| 8 | Non-numeric `measurement` stdout | poorly-shaped measurement | `inconclusive` with explanatory reason; no false verdict | `replayExperiment — verdict ladder` case "non-numeric stdout" |

## Implementation notes

- Pure decision function `replayExperiment(...)` lives in `scripts/replay-experiment.mjs`. It is referentially transparent: same input → same output. Tests inject the inputs directly; no test shells out for real.
- The CLI wrapper in the same file owns I/O: lists `experiment-store/*.jsonl`, runs the recorded measurement command, appends new JSONL rows, writes validated-learnings.md / TASKS.md, and the workflow commits the diff back to main with `[skip ci]`.
- The pivot-task block matches `tasks.md` spec format (ID / Tags / Estimate / Hypothesis / Details / Files / Verification / Measurement / Pivot / Acceptance / Anchor / Risk) so `npx @tasks-md/lint TASKS.md` continues to pass after an automated append.
- Two-consecutive-windows regression rule is enforced by `decideVerdictFromNumbers`: a single pivot crossing maps to `inconclusive` with reason "awaiting next window"; the second one to `regressed`. This matches the original task brief's Risk-mitigation clause ("require regression to persist across 2 consecutive replay windows before opening the pivot task").
