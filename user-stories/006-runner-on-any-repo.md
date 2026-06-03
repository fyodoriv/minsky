# Story 006 — Run Minsky's full constitution on any host repo

**Milestone(s)**: M1.3, M1.4, M1.9, M1.12

> Point Minsky at any of your code projects and it works through that project's to-do list with the same rules it follows on itself — without ever editing a tracked file you didn't ask it to.

Minsky is a background program that does coding work for you while you are away. You point it at a code project (a git repository) that keeps a plain-text to-do list, and it picks the most important unfinished item, asks a coding assistant to do it, and prepares a draft for you to review.

This story is **Minsky working on any host**. A *host* is one code project Minsky works on. Two commands attach Minsky to a host:

- `minsky bootstrap <host-dir>` drops a small, hidden `.minsky/` folder at the host's root. This folder is the *sidecar* — everything Minsky needs to run its rules lives here, and nothing in it is committed to the host's git history.
- `minsky run <task-id> --host <host-dir>` picks the named task from the host's to-do list and ships the work, using the same *supervisor* — the outer watchdog that keeps Minsky alive and restarts it if it dies — that Minsky uses on itself.

The counterpart story, where Minsky works on its own code, is [`user-stories/001-loop-runs-overnight.md`](001-loop-runs-overnight.md). It is the same loop and the same rules, parameterised by the `MINSKY_HOST_ROOT` environment variable (the path to the host repo). vision.md § "What Minsky is" frames this as the original Minsky vision: a plug-and-play repo transformer you attach to any git repository — a host or Minsky itself — that runs 24/7 to make medium-to-long-term improvements aligned with Minsky's rules.

Both stories are gated by **rule #12** (scope discipline, vision.md § "Scope discipline"). When the to-do list empties, the next move is stability work, not new functionality — unless the work is human-approved, market-research-only, or pre-registered as a rule-#9 experiment. A host's `.minsky/repo.yaml` may *narrow* what runs (for example, disable a live spawn for safety) but it can never widen the scope-discipline rule.

## Story

I am working on the task `proj-840-slash-command-labels` in a project under my repos folder. From any directory, I run:

```bash
minsky run proj-840 --host <repos-parent>/example-capabilities-3 --live
```

Minsky reads the matching row from the host's `TASKS.md` (the plain-text Markdown to-do list at the project root) and turns it into an `EXPERIMENT.yaml` — the file that states the change's hypothesis, success threshold, and measurement before any code is written. It then spawns the coding assistant (Claude Code) inside the host directory, with a system-prompt overlay that injects Minsky's rules. The spawn runs wrapped in `BudgetGuard`, the component that pauses work when paid model quota runs low. Minutes later, a draft pull request appears on the host's GitHub repo, its body carrying a `Hypothesis self-grade` block.

A GitHub Action that lives in Minsky's own repo then posts a `minsky-constitution` check-run on that host PR through the GitHub API. The check is green when the PR carries the self-grade, the `EXPERIMENT.yaml` lints clean (its anchor cites a primary source, its pivot states a success margin, its measurement inspects real output), and the chaos-test coverage required by rule #7 is present. It is red if any of those fail.

I never edited a single tracked file in the host repo to make any of this work. Everything Minsky needs lives in the gitignored `.minsky/` sidecar at the host root.

## Acceptance criteria

- `minsky bootstrap <host-dir>` writes a per-host `.minsky/` directory holding `repo.yaml`, a symlinked `vision.md`, an `EXPERIMENT.yaml.template`, and an empty `experiment-store/`. The directory is added to the global git ignore file (decision A2). Bootstrap is idempotent.
- `minsky run <task-id> --host <host-dir>` reads `.minsky/repo.yaml`, finds the task in the host's `TASKS.md` (default `<host>/TASKS.md`), synthesises an `EXPERIMENT.yaml`, spawns Claude Code wrapped in `BudgetGuard`, and writes the result to `<host>/.minsky/experiment-store/`.
- The spawned Claude Code session sees the canonical `vision.md` through the symlink at `<host>/.minsky/vision.md`. The rules apply unchanged.
- The PR opened by the spawn carries a `Hypothesis self-grade` block whose four fields (Predicted / Observed / Match / Lesson) are all non-empty.
- A GitHub Action in Minsky's repo (decision C2) posts a `minsky-constitution` check-run on the host PR via `gh api repos/$host_repo/check-runs`. A pre-push hook installed by `bootstrap` (decision C3) is the local fallback if the action is unreachable.
- 12 of the 13 rule lints run against the host substrate via `MINSKY_HOST_ROOT` (see [`docs/cross-repo-portability.md`](../docs/cross-repo-portability.md), grouped into the six disciplines a host opts into per [`docs/host-transformation-checklist.md`](../docs/host-transformation-checklist.md)). The one exception, `check-rule-1-novel-justification`, stays repo-local by design — the host's own source taxonomy is the host's domain, not Minsky's.
- The host's tracked files are never modified by `minsky bootstrap` or `minsky run` — only the actual code change the spawned task ships, and only at the spawned agent's hand. Verified by running `git status` on the host before a `minsky run` and immediately after `minsky bootstrap`: identical output.

## Metric

- **Name**: `cross_repo_runs_validated_pct`
- **Definition**: Percentage of `minsky run --live` invocations whose resulting host PR (a) carries the Hypothesis self-grade block, (b) passes the minsky-side check-run, (c) does NOT modify any tracked host file outside the claimed task's scope, and (d) is recorded in `experiment-store/cross-repo/` with `verdict: validated | regressed | inconclusive` (not absent).
- **Threshold**: ≥80 % over the trailing 30 days, after the runner has shipped 10 cross-repo runs. The 10-run warm-up window follows Munafò 2017 — early runs surface architectural gaps, and the threshold gates only steady-state behavior.
- **Source**: the `Observability` adapter querying `experiment-store/cross-repo/*.yaml` via `awk` count plus `gh pr view --json checks --jq` per recorded run.
- **Rationale**: A cross-repo run that doesn't write to `experiment-store` is a runner bug (the Knowledge phase never fired). A run whose PR lacks the self-grade is a rule bypass. A run that touches host files outside scope is a sandbox leak. The 80 % threshold tolerates legitimate `inconclusive` verdicts — for example, a reviewer requesting rework outside the task's hypothesis — without rewarding architecture leaks.

## Integration test

- **File**: `user-stories/006-runner-on-any-repo.test.ts` (forthcoming — lands with `cross-repo-runner-v0`, P0 in TASKS.md).
- **Setup**:
  - A tmpdir host repo at `$TMPDIR/minsky-test-host-XXXX/`, initialised as a git repo, with a fixture `package.json` and a fixture `TASKS.md` holding exactly one task row. Its ID is `runner-fixture-task-001` and its Hypothesis / Pivot / Measurement / Anchor fields satisfy rule #9.
  - `MINSKY_HOST_ROOT=$TMPDIR/minsky-test-host-XXXX/` and `MINSKY_TICK_DRY_RUN=1`. In dry-run, the spawn does not call out to Claude Code — the runner emits a `RunnerPlan` JSON instead.
  - A stub `BudgetGuard` returning `NORMAL`.
- **Action**: `bin/minsky-run.ts runner-fixture-task-001 --host $TMPDIR/minsky-test-host-XXXX --dry-run`.
- **Assert**:
  - The `RunnerPlan` JSON on stdout has the right shape: its env contains `MINSKY_HOST_ROOT`, its working directory matches `--host`, and its system prompt references the canonical `vision.md`.
  - `$host/.minsky/EXPERIMENT.yaml` is materialised with all 5 rule-#9 fields populated from the task row.
  - `$host/.minsky/experiment-store/` holds exactly one record per dry-run invocation (`status: planned`, no spawn happened).
  - `$host/.minsky/repo.yaml` is unchanged (bootstrap is separate from run).
  - The host's tracked files are byte-identical before and after (`git status --porcelain` empty in both cases).
- **Real-spawn integration test** (separate file, gated on `MINSKY_HAS_CLAUDE`): same fixture host, but `--live` instead of `--dry-run`. Asserts that a PR is opened on the fixture host's remote — a local file-protocol remote served by `git daemon`, so the test needs no GitHub auth — and that the PR body matches the `Hypothesis self-grade` regex.

## Proof

- **Live**: from inside the example host project, `minsky run proj-840-slash-command-labels --live` opens a PR on the host's GitHub repo whose checks tab shows a green `minsky-constitution` check-run alongside the host's own checks.
- **Dashboard**: the web dashboard's "Cross-repo runs / 30d" tile reads ≥80 % validated.
- **Audit**: counting `verdict: validated` records in `experiment-store/cross-repo/*.yaml` and dividing by the total record count returns ≥0.80, sustained.
- **Notification**: a single ntfy push fires per cross-repo run completion — level=info on `validated`, level=warn on `regressed`, level=warn on `inconclusive`.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: every `minsky run --live` invocation produces (a) a PR on the host repo with a parseable Hypothesis self-grade block, (b) a record in `experiment-store/cross-repo/` with a non-absent verdict, and (c) zero modifications to host tracked files outside the spawned task's claimed scope — sustained over 10 consecutive runs.
- **Blast radius**: one host-repo PR, one experiment-store record, one BudgetGuard window. It never affects the host's main branch (PRs are reviewer-gated), never affects Minsky's own daemon (the cross-repo runner runs in its own supervised process), and never affects another host (one host per invocation).
- **Operator escape hatch**: `minsky run --abort <task-id>` cancels the in-flight spawn and writes `verdict: aborted` to the experiment-store. On-machine fallback: `kill -INT $(pgrep -f minsky-run)` — the runner's `BudgetGuard` wrapper reads SIGINT as a clean-shutdown signal, and the spawned Claude Code receives `EOF` on stdin.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Host has no `.minsky/repo.yaml` | not-bootstrapped (operator-error) | `loud-crash-supervisor-restart` of the runner CLI with `bootstrap host first: minsky bootstrap <host-dir>`; runner exits non-zero before any spawn | `novel/cross-repo-runner/src/repo-config.test.ts` — fixture host without `.minsky/`, run CLI, assert exit code 1 + the bootstrap-suggestion string on stderr |
| 2 | Task-id not found in host's TASKS.md | bad-input (operator-error) | `loud-crash-supervisor-restart` with `task <id> not found in <tasks-md-path>; available ids: …`; the `…` is the actual list, sorted, max 10 entries with `…and N more` | `novel/cross-repo-runner/src/task-finder.test.ts` — fixture TASKS.md with 3 tasks, runner invoked with a 4th, assert exit + correct list |
| 3 | Task row missing required rule-#9 field (e.g., no Pivot) | rule-#9-violation (host-content-error) | `loud-crash-supervisor-restart` with `rule-9: task <id> missing <field> at <line>; rule-#9 is iron, no exemption — see vision.md § 9` | `novel/cross-repo-runner/src/experiment-synth.test.ts` — fixture TASKS.md with one task missing each of the 5 fields, run synth, assert each fails with the right field name |
| 4 | `BudgetGuard` returns PAUSE during runner invocation | budget-circuit-break (system-policy) | `circuit-break-and-notify` — runner exits with `budget paused — see /watch.json or .minsky/budget.flag`; experiment-store records `verdict: budget-paused` | `novel/cross-repo-runner/src/runner.test.ts` — mocked BudgetGuard returning PAUSE, assert exit + record + ntfy push fires |
| 5 | Host's pre-push hook conflicts with existing hook | hook-collision (host-config-state) | `graceful-degrade` — bootstrap detects existing hook (`test -x .git/hooks/pre-push`) and chains via lefthook-config OR wraps via `pre-push.minsky` + `pre-push.original`; never silently overwrites | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — fixture host with a pre-existing hook, assert chain mechanism works on second invocation |
| 6 | Spawned Claude opens a PR without the Hypothesis self-grade block | constitutional-violation (spawn-output-error) | `loud-crash-supervisor-restart` from the minsky-side GitHub Action — the check-run posts `failure` with the missing-field list; PR is mergeable from the host's perspective but has a red minsky check; reviewer gate fires | `scripts/cross-repo-check-runner.test.mjs` — synthetic PR body without self-grade, run check, assert `failure` posted |
| 7 | Host's tracked file modified by spawn outside task scope | sandbox-leak (spawn-output-error) | `circuit-break-and-notify` — runner re-reads `git diff` after spawn; if changed paths exceed `repo.yaml.allowed_paths` (declared per-task or repo-wide), record `verdict: scope-leak` and refuse to open the PR; spawned worktree preserved for review | `novel/cross-repo-runner/src/scope-check.test.ts` — fixture spawn modifies `package.json` for a task whose allowed_paths is `src/**`; assert refusal + preservation |
| 8 | Spawned Claude exceeds per-task budget cap mid-spawn | budget-mid-spawn (system-policy) | `circuit-break-and-notify` — `BudgetGuard` returns PAUSE; runner sends SIGTERM to the spawn; experiment-store records `verdict: mid-spawn-budget-paused` with the consumed-token count; resume-from-checkpoint deferred to v1 | covered by failure-mode #4's chaos test (mid-spawn is a stricter case of #4) |
| 9 | `repository_dispatch` to minsky-side action lost | network / GH-platform-flake | `circuit-break-and-notify` — host PR opens but no minsky check appears; reviewer can fire `minsky recheck <host-repo> <pr>` which re-emits the dispatch | `scripts/cross-repo-check-runner.test.mjs` — mocked dispatch failure, assert recheck-emit path works |
| 10 | Symlink to canonical `vision.md` breaks (operator moved the Minsky repo) | host-config-drift (operator-error) | `loud-crash-supervisor-restart` — `minsky bootstrap --doctor <host>` reports RED with the broken-symlink path; `--repair` re-anchors the symlink | `novel/sidecar-bootstrap/src/doctor.test.ts` — fixture host with a broken symlink, assert RED status + repair fixes |
| 11 | Two `minsky bootstrap` runs race on the same host | concurrency (operator-error) | `loud-crash-supervisor-restart` — mkdir-based lock at `.minsky/.bootstrap.lock.d` (mirrors `setup.sh`'s lock); second run exits 75 (EX_TEMPFAIL) | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — parallel invocations against the same fixture, assert second exits 75 |
| 12 | Host PR force-pushed mid-check-run | concurrency (host-action) | `graceful-degrade` — minsky check-run posts `neutral` with note "head SHA mismatch — re-emit dispatch"; never `success` on a stale SHA | `scripts/cross-repo-check-runner.test.mjs` — mocked head-SHA mismatch, assert `neutral` not `success` |
| 13 | Global git ignore file is read-only / refuses to update | filesystem-permission (operator-error) | `graceful-degrade` — bootstrap detects EACCES, falls back to per-clone `.git/info/exclude` (decision A2's documented v1 fallback), records the choice in `repo.yaml.ignore_mechanism: per-clone-exclude` | `novel/sidecar-bootstrap/src/bootstrap.test.ts` — mocked write to ignore file fails with EACCES, assert fallback path |
| 14 | Host `TASKS.md` schema drifts (new field the parser doesn't know) | upstream-schema-drift | `graceful-degrade` — parser tolerates unknown fields, ignores them, logs at level=warn; runner only uses the 5 rule-#9 fields it requires | `novel/cross-repo-runner/src/task-finder.test.ts` — fixture row with an extraneous `**Foo**:` line, assert parse succeeds + warning logged |

Weekly production fault injection: the same Sunday-timer pattern as story 001 — pick one row at random and run its chaos test against a fixture host; failures escalate to a Watch-level notification.

## Pre-registered umbrella experiment

This user story IS the umbrella rule-#9 contract for the cross-repo runner. Each implementing PR (`host-root-resolver-prep`, `minsky-sidecar-bootstrap`, `cross-repo-runner-v0`, `cross-repo-runner-proj-840-integration-test`, `cross-repo-ci-action`) ships its own `EXPERIMENT.yaml` at the repo root at PR time, with hypotheses scoped to that step. The umbrella terms below are what the *whole* feature is gated on.

- **Hypothesis** (umbrella): A host repo with a bootstrapped `.minsky/` sidecar can run Minsky's full constitution against any of its TASKS.md rows. ≥80 % of `minsky run --live` invocations across the trailing 30 days (after the 10-run warm-up) produce a host PR with the Hypothesis self-grade block, a green minsky-side check-run, an experiment-store record with a non-absent verdict, and zero out-of-scope host file modifications.
- **Success threshold**: `cross_repo_runs_validated_pct ≥ 80%` over a trailing 30-day window, sustained, after the warm-up.
- **Pivot threshold**: if the metric stays below 50 % for two consecutive 30-day windows AFTER the warm-up, the cross-repo architecture is wrong (not just under-implemented). Pivot to the documented thin-envoy mode (BudgetGuard + supervisor, no constitutional gate) and retire the sidecar architecture as a load-bearing claim. Document the per-step pivot triggers in each step's own EXPERIMENT.yaml so smaller failures surface earlier without firing the umbrella pivot prematurely.
- **Measurement** (umbrella): `bash user-stories/006-runner-on-any-repo.measurement.sh` (forthcoming, lands with `cross-repo-runner-proj-840-integration-test`) computes `cross_repo_runs_validated_pct` from `experiment-store/cross-repo/*.yaml`, prints the value, exits 0 when ≥0.80, and exits 1 otherwise.
- **Anchor**: Munafò et al., "A manifesto for reproducible science", *Nature Human Behaviour* 1, 0021, 2017 (pre-registration — this story is committed before any of the 5 implementing PRs); Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 (each `minsky run` is an actor whose universe is the host repo and whose contract is the constitution); Armstrong, *Programming Erlang*, Pragmatic Bookshelf, 2007 (the supervisor wraps the spawn — BudgetGuard is the SLA, let-it-crash on rule violations); Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003 (cross-repo runs are heterogeneous experiments the MAPE-K loop ingests via the experiment-store; the runner is the *Plan + Execute* phase of cross-repo work); rule #9 (this story IS the rule-#9 contract for the umbrella); rule #10 (the deterministic CI substrate is the minsky-side GitHub Action plus the 12 host-aware lints; no LLM sits in the constitutional-gate chain).

## Status

- **Phase**: Pre-registered. No implementation yet. Step 1 of 6 (`cross-repo-portability-doc`) shipped via PR #122 — the substrate decision is documented; the runner is not yet built.
- **Blocking**: nothing blocks *the user story*. The 5 implementing PRs (steps 2–6 in TASKS.md) ship sequentially, each with its own block. Story status updates to "Implemented" only after step 5 (`cross-repo-runner-proj-840-integration-test`) ships and the metric clears the warm-up.
- **Theoretical anchor**: Hewitt 1973 actor model (the host repo is the actor's universe; the constitution is the contract); Kephart & Chess 2003 MAPE-K (the runner is the Plan + Execute phase, the experiment-store is the Knowledge ingest, regardless of which repo the work happened in).

## Pattern conformance

- **Pattern**: Sidecar configuration + parametric substrate root (the `MINSKY_HOST_ROOT` env var) — Hewitt, "A Universal Modular ACTOR Formalism", *IJCAI* 1973 — composed with check-run-as-asynchronous-boundary — Helland, "Life beyond Distributed Transactions", *CIDR* 2007 — and supervised process spawn — Armstrong, *Programming Erlang*, 2007.
- **Conformance level**: full (planned).
- **Index row**: vision.md § "Pattern conformance index" — a new row is added when `cross-repo-runner-v0` ships, per rule #8.
- **Notes**: The actor's "universe" is `MINSKY_HOST_ROOT`; the contract is `.minsky/vision.md` plus `repo.yaml`. The check-run boundary is asynchronous: `repository_dispatch` → minsky workflow → GitHub-API check-post; the eventual-consistency window is bounded by dispatch-delivery plus workflow-run time (typically <60s). The supervised spawn is the existing `ProcessSpawnStrategy` — no new spawn surface (rule #1, don't reinvent).

## Security & privacy

Per vision.md rule #13 ("Security & privacy — second priority after performance", operator directive 2026-05-06). Industry-standard primitives only; rule #1 (don't reinvent) applies.

- **Trust boundary**: this story's untrusted inputs are the operator's TASKS.md content plus `claude --print` stdout (LLM output, treated as untrusted by default per OWASP LLM02). Trusted: the local filesystem plus the launchd unit-file's environment. Anything that crosses the boundary (PR body text, OTEL span content) passes through the secret-leak scanner (`scripts/scan-secrets.mjs`) and the no-PII span lint.
- **Secrets**: no API keys, tokens, or `.env` content in PR bodies, OTEL spans, or `.minsky/` logs. Floor: `scan-secrets` pre-commit plus `secret-scanning-precommit-and-ci` (TASKS.md P0).
- **PII**: no email, IP, or full-paths-with-username in OTEL span attributes. Floor: `otel-no-pii-in-spans-lint` (TASKS.md P0).
- **Sandbox**: the supervisor process's filesystem and network reach is restricted to what this story actually needs. Floor: `supervisor-sandbox-syscall-restriction` (TASKS.md P0); industry standard via systemd `ProtectSystem=strict` + `PrivateTmp=true`, or launchd App Sandbox.
- **Performance carve-out**: when a security restriction would cost >10 % on this story's load-bearing latency metric, the trade-off is documented here as a declared deviation with a numeric cost figure. Silent trade-offs are forbidden (vision.md rule #13's performance-first carve-out clause).
