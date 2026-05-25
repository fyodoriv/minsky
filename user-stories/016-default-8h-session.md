# Story 016 — Default 8h transformation session against any repo

**Milestone(s)**: M1

> **Operator intent, recorded 2026-05-24** (parent task `minsky-default-8h-repo-transformation`, P0). Minsky's killer-feature demo is "point at any repo, see what improved": one command captures a baseline snapshot, runs an autonomous 8-hour iteration session, and prints a before/after delta. The operator can demo Minsky's value proposition without installing anything cloud-side, without watching the loop tick, and without manually composing the snapshot / run / delta steps.

## Story

As a developer I have a midsize TypeScript repo with stale dependencies, missing tests, and a `TASKS.md` queue I haven't touched in two weeks. I've heard about Minsky but I don't want to read the full runbook — I want to point it at the repo, walk away for a few hours, and come back to a report of what changed.

I `cd /path/to/my/repo` and type:

```bash
minsky --transform
```

The session orchestrator runs in sequence:

1. **Bootstrap** — materializes `.minsky/repo.yaml` + `vision.md` symlink + `.minsky/experiments/` if the sidecar doesn't already exist. Idempotent.
2. **Baseline capture** — snapshots LOC (via `tokei` / `scc` / `cloc` if installed, else pure-Python walk), tracked file count + test file count (via `git ls-files` if `.git/` exists, else os.walk), `pnpm lint` exit code, `pnpm typecheck` / `pnpm build` exit code, `pnpm outdated` count, and doc coverage (README / AGENTS.md / CLAUDE.md / VISION.md / TASKS.md presence) into `.minsky/baseline.json`.
3. **Iteration loop** — 8 iterations of the canonical Minsky loop (pick task from TASKS.md, cut feature branch, spawn OpenHands, watch for exit, record JSONL). Default-iteration count is configurable via `--max-hours N`. Each iteration honors the dynamic p95-watchdog and the restart-sentinel propagation.
4. **Report rendering** — captures the current state via the same baseline machinery, diffs against the stored baseline, and renders either a human-readable text report (default) or structured JSON (`--json`). Source-of-truth tags (`loc_source`, `files_source`) and mismatch warnings let the operator detect cross-machine inconsistencies.

The session NEVER pushes to `main`, NEVER force-pushes, NEVER deletes branches. Draft PRs are the only side effect; the operator merges manually.

That's `minsky --transform`. One command. Bootstrap → measure → improve → report. Operator can scrape the JSON delta into a dashboard or pipe it into a CI gate.

## Acceptance criteria

1. `minsky --transform` from any `$PWD` runs the four-step orchestration end-to-end without operator interaction beyond the initial command. Each step is a separate already-shipped script (`bin/minsky-bootstrap.sh`, `scripts/baseline_metrics.py`, `bin/minsky-run.sh`, `scripts/minsky_report.py`); the orchestrator is pure composition.
2. The baseline snapshot at `.minsky/baseline.json` carries the documented `schema_version: 1` shape with `code`, `docs`, `lint`, `build`, `dependencies` blocks, and the source-of-truth tags (`code.loc_source` ∈ `{tokei, scc, cloc, walk}`; `code.files_source` ∈ `{git-ls-files, walk}`).
3. The text report shows files / tests / LOC deltas with explicit signs (`+3` / `-1` / `+0`), the source tags inline, and emits a `⚠` warning line when the source between baseline and current snapshots disagrees — with the explicit "re-run baseline" remediation hint.
4. `--json` mode emits valid parseable JSON on stdout suitable for piping to `jq` / CI gates / dashboards.
5. `--baseline-only` / `--report-only` short-circuit the run loop for the "snapshot now" / "what changed since last snapshot" sub-flows. `--no-bootstrap` skips the bootstrap step when the operator has already materialized the sidecar.
6. Restart-sentinel propagation: when an inner `minsky-run.sh` iteration exits 75 (operator-restart-requested mid-session), the orchestrator surfaces exit 75 to its caller. The supervisor (launchd / systemd) treats it as a restart signal.
7. The CLI documents itself in `bin/minsky --help`, the README's "Getting started" block, and the orchestrator's own `--help`. Source-of-truth: the comment block at the top of `bin/minsky-default-session.sh`.

## Metric

- **Name**: `transform-session-end-to-end-success`
- **Definition**: Fraction of `minsky --transform` invocations on real host repos that complete all four steps (bootstrap if needed → baseline → run → report) without crashing, measured across operator-side smoke runs.
- **Threshold**: Phase-1 ship gate: ≥1 successful smoke run on a non-fixture host repo. Phase-2 stability gate: ≥80% of weekly invocations complete successfully without operator intervention.
- **Source**: operator-side `~/.minsky/transform-runs.jsonl` ledger (TBD — currently captured only by the bash supervisor's session-level JSONL records).

## Integration test

`bin/minsky-default-session.sh` has 7 bats tests at `tests/minsky-run.bats` covering:

- `--help` prints usage and exits 0
- Missing host-dir arg exits 2
- Non-existent host-dir exits 1
- Unknown flag exits 2
- `--baseline-only` materializes `.minsky/repo.yaml` + `.minsky/baseline.json` with schema_version=1 and triggers bootstrap when needed
- `--report-only` requires existing baseline (exits 1 with remediation hint when missing)
- `--report-only` emits delta text against the existing baseline, picking up filesystem changes since baseline capture
- `--json` emits parseable JSON with the documented schema fields
- `bin/minsky --transform` dispatches to the orchestrator against `$PWD` (vertical slice 3 CLI wiring)

The contract is enforced by these bats tests on every PR via the `bash-tests` CI gate (PR #801).

## Anchor

- Forsgren / Humble / Kim 2018 *Accelerate* — DORA's four keys (lead time, deployment frequency, change failure rate, MTTR) measured before / after an intervention is the canonical "did this improvement work?" loop. `baseline → run → report` is the same shape applied to a repo's own DORA-keys.
- Ries 2011 *Lean Startup* — build-measure-learn. The baseline is the "measure" half before any "build"; the report is the "learn" half after.
- Krug 2014 *Don't Make Me Think* — one command, one obvious path. `minsky --transform` is the canonical entry point; no operator has to compose four scripts manually.

## Composition with sibling stories

- Composes with [story 001 (loop runs overnight)](001-loop-runs-overnight.md): the inner step 3 IS the autonomous loop. Story 016 wraps it with bookend snapshots.
- Composes with [story 014 (launcher-agnostic feature parity)](014-launcher-agnostic-feature-parity.md): `minsky --transform` works from any installer-agent surface (Claude Code, Cursor, Devin, Codex) because it's a bash entry point that the agent merely shells out to.
- Composes with [story 015 (local models until stable)](015-local-models-until-stable.md): the inner iterations honor the local-model stance — `minsky --transform` does not require a cloud API key.

## Shipped (PR series 812–820)

- PR #812 — `scripts/baseline_metrics.py` + 20 paired tests (slice 1)
- PR #813 — `scripts/minsky_report.py` + 23 paired tests (slice 2)
- PR #814 — `bin/minsky-default-session.sh` orchestrator + 7 bats tests (slice 3)
- PR #815 — `bin/minsky --transform` CLI dispatch + drive-by bash quoting fix in the resolver
- PR #816 — README documents the killer-feature command
- PR #817 — baseline uses tokei / scc / cloc for LOC (rule #1)
- PR #818 — baseline uses `git ls-files` for file/test counts (rule #1)
- PR #819 — report surfaces `loc_source` / `files_source` + mismatch warning
- PR #820 — `--json` flag forwards through the orchestrator

## Pivot

If `transform-session-end-to-end-success` < 80% over a trailing 4-week window of operator-side dogfood runs (e.g. the orchestrator crashes mid-session more often than not), the vertical slice retains its component scripts (baseline / report) as standalone utilities and the orchestrator is moved to a `--experimental` opt-in flag until the failure mode is named + fixed.

If the operator decides the bare `minsky` (no flags) should fold into `minsky --transform` instead of the existing daemon-auto-attach behavior, that's a separate task — story 016 covers only the explicit `--transform` opt-in.
