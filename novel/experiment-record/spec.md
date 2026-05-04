# `@minsky/experiment-record` — `EXPERIMENT.yaml` format

A small declarative YAML record carried by every non-trivial PR per [constitutional rule #9](../../vision.md#9-pre-registered-hypothesis-driven-development--iron-rule-no-exceptions-including-bugfixes) (pre-registered hypothesis-driven development). The five mandatory fields (Hypothesis / Success / Pivot / Measurement / Anchor) plus an experiment id and replay windows are exactly what rule #9 already requires in PR descriptions; this format makes them machine-checkable.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Pattern**: pre-registration record (Munafò et al., "A Manifesto for Reproducible Science", *Nature Human Behaviour* 2017) + JSON-Schema-validated DTO (Fowler, *Patterns of Enterprise Application Architecture*, 2002).
- **Concrete reference**: the [AsPredicted.org](https://aspredicted.org) template, but tightened to a machine-checkable schema.
- **Conformance**: full. Every field carries its rule-#9 contract; nothing new invented.

## File location

Experiment records live at `experiments/<id>.yaml` at the repo root (one file per pre-registered experiment). Per [`experiments-directory-migration`](../../TASKS.md), the singleton `EXPERIMENT.yaml` shape was retired in favour of plural records: a single PR may carry multiple experiments, and cross-repo `minsky run` invocations each produce their own record without colliding on a singleton path.

The filename matches the record's `id:` field (e.g. `experiments/tick-loop-spawn-args-fresh-session-2026-05-04.yaml` for `id: tick-loop-spawn-args-fresh-session-2026-05-04`). The `id:` is the canonical identifier; the filename is a convenience for filesystem discovery. The per-PR runner walks `experiments/*.yaml`, gates each, and stores the parsed records under `experiment-store/<id>.jsonl` after merge.

The legacy singleton `EXPERIMENT.yaml` at the repo root is forbidden by the `check-no-singleton-experiment` ratchet (`scripts/check-no-singleton-experiment.mjs`). Restoring it requires retiring the migration — recorded explicitly in `vision.md` § Pattern conformance index, not via a workaround.

## Schema

The full JSON Schema (draft-07) is in [`schema.json`](./schema.json). Required fields:

| Field          | Type       | Constraints                                     | Rule-#9 mapping     |
|----------------|------------|-------------------------------------------------|---------------------|
| `id`           | string     | kebab-case (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`)     | experiment-id       |
| `hypothesis`   | string     | min length 20                                   | Hypothesis          |
| `success`      | string     | min length 5                                    | Success threshold   |
| `pivot`        | string     | min length 5                                    | Pivot threshold     |
| `measurement`  | string     | min length 5; runnable command (validator-checked) | Measurement         |
| `anchor`       | string     | min length 5                                    | Literature anchor   |

Optional:

| Field                 | Type       | Default   | Constraints           |
|-----------------------|------------|-----------|-----------------------|
| `replay_windows_days` | int[]      | `[7, 30]` | each ∈ `[1, 365]`     |
| `timeout_seconds`     | int        | `60`      | ∈ `[1, 3600]`         |

`additionalProperties: false` — unknown fields are rejected.

`timeout_seconds` is the per-experiment wall-clock cap applied by the [ci-experiment-runner-v0](../../docs/experiment-runner.md) (rule #9 daily layer). The default 60 s suits unit-test-shaped measurements; raise it for legitimately heavier measurements (e.g., integration suites). The runner enforces the cap on both the gate (executability check) and the post-merge record step.

## Validator-only checks (beyond JSON Schema)

The validator additionally rejects:

- **Vanity metrics** — `success` or `pivot` containing forbidden phrases (case-insensitive substrings: `lines of code`, `commits made`, `hours spent`, `tasks in flight`, `loc count`, `commit count`). Source: rule #9's anti-pattern list (Ries 2011; Doerr 2018).
- **Empty replay-windows arrays** — JSON Schema accepts `[]`; the validator rejects it because zero replay windows means the weekly-monthly tracker layer never runs against this experiment.

## Example

```yaml
id: budget-guard-flag-file
hypothesis: |
  Atomic write of NORMAL/THROTTLE/PAUSE/WEEKLY_WARN to
  ${MINSKY_HOME}/.minsky/budget.flag via tmp-file + rename(2) lets shell
  consumers read the current decision without parsing JSON.
success: "flag-file tests at 100% coverage; integration test passes within 10s"
pivot: "if shell consumers ever need atomic multi-field state, pivot to .minsky/budget.json"
measurement: "pnpm vitest run novel/budget-guard/src/flag-file.test.ts"
anchor: "POSIX rename(2) atomicity guarantee; setup.sh's atomic-lock pattern"
replay_windows_days: [7, 30]
```

## Failure modes & chaos verification

Per constitutional rule #7.

- **Steady-state hypothesis**: `parse(yaml)` returns either a valid `ExperimentRecord` or a structured `ParseError[]` for every legitimate YAML input.
- **Blast radius**: a single experiment record. Parser is pure (no I/O).
- **Operator escape hatch**: bypass via `<!-- experiment: trivial — see exemption.md -->` comment in the PR description (handled by the runner, not by this parser).

| # | Failure mode                                       | Trigger / fault axis                                | Expected behavior                                                              | Chaos test                                  |
|---|----------------------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------------------|---------------------------------------------|
| 1 | Malformed YAML (unbalanced quotes, bad indent)     | upstream-malformed                                  | `graceful-degrade` — return `ParseError` with `kind: bad-yaml` and the line     | covered by `invalid-bad-yaml.yaml` fixture  |
| 2 | Missing required field (e.g., `pivot`)             | upstream-malformed                                  | `graceful-degrade` — return `ParseError` with `kind: missing-required-field`    | covered by `invalid-missing-pivot.yaml`     |
| 3 | Vanity metric in `success` (e.g., "more commits")  | rule-#9 anti-pattern                                | `graceful-degrade` — return `ParseError` with `kind: vanity-metric`             | covered by `invalid-vanity-metric.yaml`     |
| 4 | Unknown extra field                                | upstream-malformed                                  | `graceful-degrade` — return `ParseError` with `kind: unknown-field`             | covered by JSON Schema's `additionalProperties: false` |
| 5 | `replay_windows_days: []`                          | edge case                                           | `graceful-degrade` — return `ParseError` with `kind: empty-replay-windows`      | covered by parser test                      |
