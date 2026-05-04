# Story 006 — Run minsky's full constitution on any host repo

## Story

I'm working on `aifn-840-slash-command-labels` in `~/apps/iep-capabilities-3`. From any directory, I run `minsky run aifn-840 --host ~/apps/iep-capabilities-3 --live`. Minsky synthesises an `EXPERIMENT.yaml` from the host's `TASKS.md` row, spawns Claude Code in the host directory with a system-prompt overlay that injects the constitution, wraps the spawn in `BudgetGuard`, and watches the resulting PR appear on the host's GitHub repo with a `Hypothesis self-grade` block in its body. A minsky-side GitHub Action (running in `fyodoriv/minsky`) posts a `minsky-constitution` check-run on the host PR via the GitHub API. The check is green if the PR carries the self-grade, the `EXPERIMENT.yaml` lints clean (anchor primary-source / pivot success-margin / measurement inspects-output), and rule-7 chaos coverage is present; red if any of those fail. I never edited a single tracked file in the host repo to enable any of this — the substrate that makes minsky's lints work lives in a gitignored `.minsky/` sidecar at the host root.

## Acceptance criteria

- `minsky bootstrap <host-dir>` writes a per-host `.minsky/` directory with `repo.yaml`, a symlinked `vision.md`, an `EXPERIMENT.yaml.template`, and an empty `experiment-store/`. The directory is added to global `~/.config/git/ignore` (decision A2). Bootstrap is idempotent.
- `minsky run <task-id> --host <host-dir>` reads `.minsky/repo.yaml`, locates the task in the host's `TASKS.md` (default `<host>/TASKS.md`), synthesises an `EXPERIMENT.yaml`, spawns Claude Code wrapped in `BudgetGuard`, and writes the iteration result to `<host>/.minsky/experiment-store/`.
- The spawned Claude Code session sees the canonical `vision.md` via the symlink at `<host>/.minsky/vision.md`. Constitutional rules apply unchanged.
- The PR opened by the spawn carries a `Hypothesis self-grade` block whose four fields (Predicted / Observed / Match / Lesson) are all non-empty.
- A minsky-side GitHub Action (decision C2) posts a `minsky-constitution` check-run on the host PR via `gh api repos/$host_repo/check-runs`. Pre-push hook installed by `bootstrap` (decision C3) is the local fallback if the action is unreachable.
- 12 of the 13 rule lints (per [`docs/cross-repo-portability.md`](../docs/cross-repo-portability.md)) run against the host substrate via `MINSKY_HOST_ROOT`. The one exception (`check-rule-1-novel-justification`) stays repo-local *by design* — the host's source taxonomy is the host's domain, not minsky's.
- The host repo's tracked files are never modified by `minsky bootstrap` or `minsky run` — only the actual code change the spawned task ships, and only at the spawned agent's hand. Verified by `git status` on the host *before* a `minsky run` and *immediately after* `minsky bootstrap`: identical output.

## Metric

- **Name**: `cross_repo_runs_validated_pct`
- **Definition**: Percentage of `minsky run --live` invocations whose resulting host PR (a) carries the Hypothesis self-grade block, (b) passes the minsky-side check-run, (c) does NOT modify any tracked host file outside the scope of the claimed task, *and* (d) is recorded in `experiment-store/cross-repo/` with `verdict: validated | regressed | inconclusive` (not absent).
- **Threshold**: ≥80 % over the trailing 30 days, *after* the runner has shipped 10 cross-repo runs (the warm-up window per Munafò 2017 — early runs surface architectural gaps, the threshold gates steady-state).
- **Source**: `Observability` adapter querying `experiment-store/cross-repo/*.yaml` via `awk` count + `gh pr view --json checks --jq` per recorded run.
- **Rationale**: A cross-repo run that doesn't write to `experiment-store` is a runner bug (the Knowledge phase didn't fire); a run whose PR doesn't carry the self-grade is a constitutional bypass; a run that touches host files outside scope is a sandbox leak. The 80 % threshold tolerates legitimate `inconclusive` verdicts (e.g., reviewer requested rework that's outside the task's hypothesis) without rewarding architecture leaks.

## Integration test

- **File**: `user-stories/006-runner-on-any-repo.test.ts` (forthcoming — lands with `cross-repo-runner-v0`, P0 in TASKS.md).
- **Setup**:
  - Tmpdir host repo at `$TMPDIR/minsky-test-host-XXXX/`, initialised as a git repo, with a fixture `package.json`, fixture `TASKS.md` containing exactly one task row whose ID is `runner-fixture-task-001` and whose Hypothesis / Pivot / Measurement / Anchor fields satisfy rule #9.
  - `MINSKY_HOST_ROOT=$TMPDIR/minsky-test-host-XXXX/` and `MINSKY_TICK_DRY_RUN=1` (the spawn doesn't actually call out to Claude Code; the runner emits a `RunnerPlan` JSON instead).
  - A stub `BudgetGuard` returning `NORMAL`.
- **Action**: `bin/minsky-run.ts runner-fixture-task-001 --host $TMPDIR/minsky-test-host-XXXX --dry-run`.
- **Assert**:
  - `RunnerPlan` JSON emitted to stdout has the right shape (env contains `MINSKY_HOST_ROOT`, working directory matches `--host`, system prompt references the canonical `vision.md`).
  - `$host/.minsky/EXPERIMENT.yaml` is materialised with all 5 rule-#9 fields populated from the task row.
  - `$host/.minsky/experiment-store/` contains exactly one record per dry-run invocation (`status: planned`, no spawn happened).
  - `$host/.minsky/repo.yaml` is unchanged (bootstrap is separate from run).
  - Tracked files in the host repo are byte-identical before and after (`git status --porcelain` empty in both cases).
- **Real-spawn integration test** (separate file, gated on `MINSKY_HAS_CLAUDE`): same fixture host, but `--live` instead of `--dry-run`. Asserts a PR is opened on the fixture host's remote (a local file-protocol remote, `git daemon`-served, so the test doesn't need GitHub auth) and the PR body matches the `Hypothesis self-grade` regex.

## Proof

- **Live**: `cd ~/apps/iep-capabilities-3 && minsky run aifn-840-slash-command-labels --live` opens a PR on `expertnetwrk-portal/iep-capabilities` whose checks tab shows a green `minsky-constitution` check-run alongside the host's own checks.
- **Dashboard**: Web dashboard's "Cross-repo runs / 30d" tile reads ≥80 % validated.
- **Audit**: `cat ~/apps/minsky/experiment-store/cross-repo/*.yaml | grep -c "verdict: validated"` divided by total record count returns ≥0.80, sustained.
- **Notification**: A single ntfy push fires per cross-repo run completion, level=info on `validated`, level=warn on `regressed`, level=warn on `inconclusive`.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: every `minsky run --live` invocation produces (a) a PR on the host repo with a parseable Hypothesis self-grade block, (b) a record in `experiment-store/cross-repo/` with non-absent verdict, (c) zero modifications to host tracked files outside the spawned task's claimed scope, sustained over 10 consecutive runs.
- **Blast radius**: a single host-repo PR / a single experiment-store record / one BudgetGuard window. Never affects the host repo's main branch (PRs are reviewer-gated), never affects minsky's own daemon (the cross-repo runner runs in its own process, supervised separately), never affects another host repo (the runner is single-host per invocation).
- **Operator escape hatch**: `minsky run --abort <task-id>` cancels the in-flight spawn and writes `verdict: aborted` to the experiment-store. On-machine fallback: `kill -INT $(pgrep -f minsky-run)` — the runner's `BudgetGuard` wrapper interprets SIGINT as a clean-shutdown signal and the spawned Claude Code receives `EOF` on stdin.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Host has no `.minsky/repo.yaml` | not-bootstrapped (operator-error) | `loud-crash-supervisor-restart` of the runner CLI with `bootstrap host first: minsky bootstrap <host-dir>`; runner exits non-zero before any spawn | `novel/cross-repo-runner/src/repo-config.test.ts` — fixture host without `.minsky/`, run CLI, assert exit code 1 + the bootstrap-suggestion string on stderr |
| 2 | Task-id not found in host's TASKS.md | bad-input (operator-error) | `loud-crash-supervisor-restart` with `task <id> not found in <tasks-md-path>; available ids: …`; the `…` is the actual list, sorted, max 10 entries with `…and N more` | `novel/cross-repo-runner/src/task-finder.test.ts` — fixture TASKS.md with 3 tasks, runner invoked with a 4th, assert exit + correct list |
| 3 | Task row missing required rule-#9 field (e.g., no Pivot) | rule-#9-violation (host-content-error) | `loud-crash-supervisor-restart` with `rule-9: task <id> missing <field> at <line>; rule-#9 is iron, no exemption — see vision.md § 9` | `novel/cross-repo-runner/src/experiment-synth.test.ts` — fixture TASKS.md with one task missing each of the 5 fields, run synth, assert each fails with the right field name |
| 4 | `BudgetGuard` returns PAUSE during runner invocation | budget-circuit-break (system-policy) | `circuit-break-and-notify` — runner exits with `budget paused — see /watch.json or .minsky/budget.flag`; experiment-store records `verdict: budget-paused` | `novel/cross-repo-runner/src/runner.test.ts` — mocked BudgetGuard returning PAUSE, assert exit + record + ntfy push fires |
| 5 | Host's pre-push hook conflicts with existing hook | hook-collision (host-config-state) | `graceful-degrade` — bootstrap detects existing hook (`test -x .git/hooks/pre-push`) and chains via lefthook-config OR wraps via `pre-push.minsky` + `pre-push.original`; never silently overwrites | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — fixture host with a pre-existing hook, assert chain mechanism works on second invocation |
| 6 | Spawned Claude opens a PR without the Hypothesis self-grade block | constitutional-violation (spawn-output-error) | `loud-crash-supervisor-restart` from the minsky-side GitHub Action — the check-run posts `failure` with the missing-field list; PR is mergeable from host's perspective but has a red minsky check; reviewer gate fires | `scripts/cross-repo-check-runner.test.mjs` — synthetic PR body without self-grade, run check, assert `failure` posted |
| 7 | Host's tracked file modified by spawn outside task scope | sandbox-leak (spawn-output-error) | `circuit-break-and-notify` — runner re-reads `git diff` after spawn; if changed paths exceed `repo.yaml.allowed_paths` (declared per-task or repo-wide), record `verdict: scope-leak` and refuse to open PR; spawned worktree preserved for review | `novel/cross-repo-runner/src/scope-check.test.ts` — fixture spawn modifies `package.json` for a task whose allowed_paths is `src/**`; assert refusal + preservation |
| 8 | Spawned Claude exceeds per-task budget cap mid-spawn | budget-mid-spawn (system-policy) | `circuit-break-and-notify` — `BudgetGuard` returns PAUSE; runner sends SIGTERM to spawn; experiment-store records `verdict: mid-spawn-budget-paused` with the consumed-token count; resume-from-checkpoint deferred to v1 | covered by failure-mode #4's chaos test (mid-spawn is a stricter case of #4) |
| 9 | `repository_dispatch` to minsky-side action lost | network / GH-platform-flake | `circuit-break-and-notify` — host PR opens but no minsky check appears; reviewer can fire `minsky recheck <host-repo> <pr>` which re-emits the dispatch | `scripts/cross-repo-check-runner.test.mjs` — mocked dispatch failure, assert recheck-emit path works |
| 10 | Symlink to canonical `vision.md` breaks (operator moved `~/apps/minsky/`) | host-config-drift (operator-error) | `loud-crash-supervisor-restart` — `minsky bootstrap --doctor <host>` reports RED with the broken-symlink path; `--repair` re-anchors the symlink | `novel/sidecar-bootstrap/src/doctor.test.ts` — fixture host with a broken symlink, assert RED status + repair fixes |
| 11 | Two `minsky bootstrap` runs race on the same host | concurrency (operator-error) | `loud-crash-supervisor-restart` — mkdir-based lock at `.minsky/.bootstrap.lock.d` (mirrors `setup.sh`'s lock); second run exits 75 (EX_TEMPFAIL) | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — parallel invocations against same fixture, assert second exits 75 |
| 12 | Host PR force-pushed mid-check-run | concurrency (host-action) | `graceful-degrade` — minsky check-run posts `neutral` with note "head SHA mismatch — re-emit dispatch"; never `success` on a stale SHA | `scripts/cross-repo-check-runner.test.mjs` — mocked head-SHA mismatch, assert `neutral` not `success` |
| 13 | Global `~/.config/git/ignore` is read-only / refuses to update | filesystem-permission (operator-error) | `graceful-degrade` — bootstrap detects EACCES, falls back to per-clone `.git/info/exclude` (decision A2's documented v1 fallback), records the choice in `repo.yaml.ignore_mechanism: per-clone-exclude` | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — mocked write to ignore file fails with EACCES, assert fallback path |
| 14 | Host `TASKS.md` schema drifts (new field that the parser doesn't know) | upstream-schema-drift | `graceful-degrade` — parser tolerates unknown fields, ignores them, logs at level=warn; runner only uses the 5 rule-#9 fields it requires | `novel/cross-repo-runner/src/task-finder.test.ts` — fixture row with extraneous `**Foo**:` line, assert parse succeeds + warning logged |

Weekly production fault injection: same Sunday-timer pattern as story 001 — pick one row at random and run its chaos test against a fixture host; failures escalate to a Watch-level notification.

## Pre-registered umbrella experiment

This user story IS the umbrella rule-#9 contract for the cross-repo runner. Per-step PRs (`host-root-resolver-prep`, `minsky-sidecar-bootstrap`, `cross-repo-runner-v0`, `cross-repo-runner-aifn-840-integration-test`, `cross-repo-ci-action`) each ship their own `EXPERIMENT.yaml` at the repo root at PR time, with hypotheses scoped to that step. The umbrella terms below are what the *whole* feature is gated on.

- **Hypothesis** (umbrella): A host repo with a bootstrapped `.minsky/` sidecar can run minsky's full constitution against any of its TASKS.md rows. ≥80 % of `minsky run --live` invocations across the trailing 30 days (after the 10-run warm-up) produce a host PR with the Hypothesis self-grade block, a green minsky-side check-run, an experiment-store record with non-absent verdict, and zero out-of-scope host file modifications.
- **Success threshold**: `cross_repo_runs_validated_pct ≥ 80%` over a trailing 30-day window, sustained, after the warm-up.
- **Pivot threshold**: if the metric stays below 50 % for two consecutive 30-day windows AFTER the warm-up, the cross-repo architecture is wrong (not just under-implemented). Pivot to the documented thin-envoy mode (BudgetGuard + supervisor, no constitutional gate) and retire the sidecar architecture as a load-bearing claim. Document the per-step pivot triggers in each step's own EXPERIMENT.yaml so smaller failures surface earlier without firing the umbrella pivot prematurely.
- **Measurement** (umbrella): `bash user-stories/006-runner-on-any-repo.measurement.sh` (forthcoming, lands with `cross-repo-runner-aifn-840-integration-test`) computes `cross_repo_runs_validated_pct` from `experiment-store/cross-repo/*.yaml` and prints the value; exits 0 when ≥0.80, exits 1 otherwise.
- **Anchor**: Munafò et al., "A manifesto for reproducible science", *Nature Human Behaviour* 1, 0021, 2017 (pre-registration — this story is committed before any of the 5 implementing PRs); Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 (each `minsky run` is an actor whose universe is the host repo and whose contract is the constitution); Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007 (supervisor wrapping the spawn — BudgetGuard is the SLA, let-it-crash on rule violations); Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003 (cross-repo runs are heterogeneous experiments the MAPE-K loop ingests via the experiment-store; the runner is the *Plan + Execute* phase of cross-repo work); rule #9 (this story IS the rule-#9 contract for the umbrella); rule #10 (the deterministic CI substrate is the minsky-side GitHub Action + the 12 host-aware lints; no LLM in the constitutional-gate chain).

## Status

- **Phase**: Pre-registered. No implementation yet. Step 1 of 6 (`cross-repo-portability-doc`) shipped via PR #122 — the substrate decision is documented; the runner is not yet built.
- **Blocking**: nothing blocks *the user story*. The 5 implementing PRs (steps 2–6 in TASKS.md) ship sequentially and each has its own block. Story status updates to "Implemented" only after step 5 (`cross-repo-runner-aifn-840-integration-test`) ships and the metric clears the warm-up.
- **Theoretical anchor**: Hewitt 1973 actor model (the host repo is the actor's universe; the constitution is the contract); Kephart & Chess 2003 MAPE-K (the runner is the Plan + Execute phase, the experiment-store is the Knowledge ingest, regardless of which repo the work happened in).

## Pattern conformance

- **Pattern**: Sidecar configuration + parametric substrate root (`MINSKY_HOST_ROOT` env var) — Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 — composed with check-run-as-asynchronous-boundary — Helland, "Life beyond Distributed Transactions", *CIDR* 2007 — and supervised process spawn — Armstrong, *Programming Erlang*, 2007.
- **Conformance level**: full (planned).
- **Index row**: vision.md § "Pattern conformance index" — new row added when `cross-repo-runner-v0` ships per rule #8.
- **Notes**: The actor's "universe" is `MINSKY_HOST_ROOT`; the contract is `.minsky/vision.md` + `repo.yaml`. The check-run boundary is asynchronous: `repository_dispatch` → minsky workflow → GitHub-API check-post; eventual-consistency window is bounded by dispatch-delivery + workflow-run time (typically <60s). The supervised spawn is the existing `ProcessSpawnStrategy` — no new spawn surface (rule #1 — don't reinvent).
