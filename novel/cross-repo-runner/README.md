<!-- rule-1: existing single-shot agent runners (npx claude-code, pnpm dlx claude, manual `claude --print` invocations) rejected because: those tools only run Claude Code; they do not (a) read a host's `.minsky/repo.yaml` overlay to know the host's commit format / branch prefix / pre-commit command, (b) synthesise an `EXPERIMENT.yaml` from the host's TASKS.md row to satisfy rule #9 pre-registration, (c) wrap the spawn in `BudgetGuard`'s circuit-break (rule #6 — let-it-crash AT the right boundary, not on token-exhaustion mid-task), or (d) write an iteration record into the host's gitignored `experiment-store/` so the MAPE-K loop can ingest cross-repo runs. The cross-repo-runner is the orchestrator above the existing primitives — it reuses `@minsky/tick-loop`'s ProcessSpawnStrategy + `@minsky/budget-guard` (rule #1 — wrap, don't replace) but composes them with the per-host substrate that the bare runners can't address. A generic agent-orchestration framework (LangChain, AutoGen, CrewAI) is over-engineering for the v0 surface (single-task / single-host / single-spawn) and would violate rule #2 (every dep behind interface) by importing a multi-agent runtime when only the single-spawn primitive is needed. -->

# `@minsky/cross-repo-runner`

> `minsky run <task-id> --host <host-dir>` — ship a task in a host repo under minsky's full constitution.

Step 5 of 7 in the cross-repo-runner roadmap. Built on top of `@minsky/sidecar-bootstrap` (the host's `.minsky/` substrate) and the host-root-resolver (lints honour `MINSKY_HOST_ROOT`). The runner is the orchestrator that reads the host's overlay, finds the task, synthesises an `EXPERIMENT.yaml` per rule #9, and (in v1) spawns Claude Code wrapped in `BudgetGuard`.

## `dispatch-emit` (decision C2 hook, v0)

`src/dispatch-emit.ts` exports `buildDispatchPayload({hostRepo, prNumber, experimentYamlUrl})` — the pure function that returns the `gh api .../dispatches` argv array the runner emits when it opens a host PR. The minsky-side workflow at `.github/workflows/cross-repo-check.yml` listens for that `repository_dispatch` (`event_type=cross-repo-pr`) and posts a `minsky-constitution` check-run on the host PR. v0 is build-only: the runner does not yet *call* `gh` with the argv (operator-driven; tracked as follow-up). Live `gh api .../check-runs` POST in the workflow is gated on `vars.MINSKY_BOT_INSTALLED=1`. See `experiments/cross-repo-ci-action-2026-05-04.yaml` for the rule-#9 pre-registration.

## Pattern conformance

Per [vision.md § "Pattern conformance index"](../../vision.md#pattern-conformance-index):

- **Pattern**: pure-function-with-I/O-at-edge (Martin 2017) + Command pattern (Gamma 1994 — the `RunnerPlan` is data the executor walks). Reuses `ProcessSpawnStrategy` (Gamma 1994 Strategy seam) + `BudgetGuard` (Erlang/OTP supervisor wrapping per Armstrong 2007) — no new spawn primitive.
- **Conformance**: full for the planner / loader / synth / record. v0 ships dry-run as the safe default; live-spawn wiring (importing `@minsky/tick-loop` + `@minsky/budget-guard` and invoking them from the bin) is an explicit v1 follow-up so v0 stays small and reviewable.

## Usage

```bash
# Dry-run (default): writes the EXPERIMENT.yaml + emits the RunnerPlan to stdout.
minsky-run aifn-840-slash-command-labels --host ~/apps/iep-capabilities-3

# Live-spawn placeholder (v0): also writes the EXPERIMENT.yaml + plan; in v1
# this will spawn Claude Code wrapped in BudgetGuard.
minsky-run aifn-840-slash-command-labels --host ~/apps/iep-capabilities-3 --live
```

The host must be bootstrapped first via `minsky-bootstrap <host-dir>`. The runner reads `.minsky/repo.yaml` and writes to `.minsky/experiments/<id>.yaml` + `.minsky/experiment-store/cross-repo/<id>.jsonl`.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: `minsky-run <task-id> --host <host>` against a bootstrapped host with a complete rule-#9 task block produces (a) an EXPERIMENT.yaml at `<host>/.minsky/experiments/<id>.yaml`, (b) an iteration record at `<host>/.minsky/experiment-store/cross-repo/<id>.jsonl`, (c) a non-zero exit only on rule-#9 violations or operator-input errors.
- **Blast radius**: a single host repo's `.minsky/experiments/` + a single line appended to the host's `.minsky/experiment-store/`. Never touches the host's tracked files. Never modifies the host's git config. Spawned Claude Code (v1) is a single child process the operator can SIGINT.
- **Operator escape hatch**: `Ctrl-C` at any point; the runner is interruptible and only writes the EXPERIMENT.yaml after rule-#9 validation passes.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Host not bootstrapped (no `.minsky/repo.yaml`) | not-bootstrapped | `loud-crash-supervisor-restart` — runner exits 1 with `Run minsky-bootstrap <host> first` test message | manual integration test asserts CLI exits 1 with the expected stderr |
| 2 | `.minsky/repo.yaml` invalid | host-config-drift | `loud-crash-supervisor-restart` — runner exits 1 with field-level error from `parseRepoConfig` | covered by `repo-config-loader.test.ts` (`a missing required field is reported` test case) |
| 3 | Task ID not found in host's TASKS.md | bad-input | `loud-crash-supervisor-restart` — runner exits 1 with available IDs list (max 10) | covered by `task-finder.test.ts` (`returns ok:false with available IDs when no match` test case) |
| 4 | Task block missing rule-#9 fields (Hypothesis / Success / Pivot / Measurement / Anchor) | rule-#9 violation | `loud-crash-supervisor-restart` — runner exits 1 with all missing field names; `Rule #9 is iron — no exemption` message | covered by `experiment-synth.test.ts` (multi-missing assert test cases) |
| 5 | Sidecar `experiment-store/cross-repo/` doesn't exist | filesystem | `graceful-degrade` — runner creates the directory recursively before append | manual smoke test verifies the runner creates the missing directory and appends the record |
| 6 | Two `minsky-run` invocations race against the same task on the same host | concurrency | `graceful-degrade` — both runs produce the same dry-run plan; v0's append-only iteration-store records two `planned` lines instead of one (operator deduplicates manually); v1's live-spawn boundary will add a per-host file-lock | manual integration assert: parallel invocations both exit 0 with identical plans |
| 7 | Spawned Claude Code modifies host tracked files outside the task scope | sandbox-leak (v1) | `circuit-break-and-notify` — runner re-reads `git diff` after spawn; out-of-scope changes record `verdict: scope-leak` | (deferred — covered when `cross-repo-runner-v1-live-spawn` ships and the live-spawn path is exercised) |

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: the host repo's `.minsky/repo.yaml` (could be tampered with by another local process); the host's `TASKS.md` task block; the spawned Claude Code child's writes back into the host worktree (v1 live-spawn).
- **Trusted state**: this repo's source for the runner; `gh` CLI authentication is the operator's keychain entry, never echoed; the rule-#9 task-block schema is constants in `experiment-synth.ts`.
- **Trust boundary**: every cross-repo write lands inside `<host>/.minsky/` (an opt-in directory) — never in tracked files (Failure mode #7 above is the v1 backstop). `gh` shell-outs use array-form arguments — never string-templated bash.
- **STRIDE focus**: **T**ampering — out-of-scope file writes by the spawned child are detected via `git diff` post-spawn (scope-leak verdict); **E**levation of privilege — the runner runs as the operator's user, never `sudo`; spawned Claude inherits no extra capabilities beyond the operator's environment.
- **Performance-first carve-out** (rule #13's relief valve): none declared.

## Tests

43 paired vitest cases across 5 files:

- `task-finder.test.ts` (14) — parses tasks.md sections / ID / tags / details / rule-#9 fields; ID match; title-substring matching; not-found reporting
- `experiment-synth.test.ts` (10) — happy-path YAML rendering; rule-#9 iron-rule violations (missing fields)
- `spawn-plan.test.ts` (12) — plan shape; branch naming; env vars; system-prompt overlay; brief
- `iteration-record.test.ts` (4) — JSONL rendering; verdict variants; null pr_url
- `repo-config-loader.test.ts` (3) — flat-YAML parser; nested map; comments; happy/missing-required cases (subset; the `parseRepoConfig` validator's exhaustive cases ship in `@minsky/sidecar-bootstrap`)
