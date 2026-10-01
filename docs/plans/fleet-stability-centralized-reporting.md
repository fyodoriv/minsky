# Plan: `fleet-stability-centralized-reporting`

- **Task**: `fleet-stability-centralized-reporting` (TASKS.md line 231 — P0, milestone M1)
- **Repo**: `<minsky-repo>`
- **Author**: claude-opus-4-7-max session 2026-05-20
- **Status**: validated (post-revision)
- **Validated-by**: reviewer-subagent on 2026-05-20 — round 1 needs-revision with 3 shape/integration ambiguities; round 2 verdict appended below

## Goal

Ship a `scripts/stability-report.mjs` that computes minsky's iteration-success ratio over configurable windows (10h / 24h / 7d / 30d) from the existing `.minsky/experiment-store/cross-repo/*.jsonl` ledger, then promote the `loop-uptime` METRICS.md entry from a proxy (active-commit-days) to a real measurement. Fleet aggregation (`scripts/fleet-stability-report.mjs`) ships per the task's Pivot — shared-filesystem path for v1; deferred git-sync / HTTP modes.

## Why

Today METRICS.md's `loop-uptime` line carries an explicit disclaimer:

> "43.3% active days (13/30d) — **proxy metric** (days with ≥1 commit, not actual daemon uptime). Real daemon uptime requires `orchestrate.jsonl` — tracked in `fleet-stability-centralized-reporting`."

And `mttr` is a stub:

> "(stub) — requires OTEL backend for supervisor restart-to-claim latency spans (M1 gap); `orchestrate.jsonl` proxy tracked in `fleet-stability-centralized-reporting`"

Two M1-critical METRICS.md entries point at THIS task as their blocker. Until it ships:

- The `self-metrics-competitive-benchmark` scorecard (top P0, planned in `docs/plans/self-metrics-competitive-benchmark.md`) cannot quote a real minsky stability number; it gets stuck with `null` cells.
- The `competitive-scorecard-add-per-call-token-overhead` follow-up has no minsky-side baseline to compare against published competitor numbers.
- Per minsky vision.md rule #4 ("everything measurable, everything visible"), the largest single observability gap on the dashboard is this one.

The data the task needs is already there. Running `node scripts/stability-number.mjs --json` on this machine returns `{stability_pct: 9, successful: 5, total: 54, window: "7d", source: "experiment-store"}` — a real, terrible-but-honest 9% number computed from the experiment-store. The work is generalizing this single-window script into a proper multi-window report + wiring it into the metric collection pipeline.

## Important correction of the task's assumptions

The TASKS.md task block says "each minsky instance already writes to `.minsky/orchestrate.jsonl`" implying iteration outcomes live there. **This is wrong.** I verified on-disk:

- `.minsky/orchestrate.jsonl` is produced by `scripts/orchestrate.mjs` — the **Opus orchestrator's heartbeat ledger** (tick log + sweep results). On this machine, this file does NOT exist (orchestrator hasn't been run).
- `.minsky/experiment-store/cross-repo/*.jsonl` is where **iteration outcomes** live — one file per task ID, multiple iterations each, every iteration tagged with `verdict: "validated" | "spawn-failed" | "scope-leak" | ...`. This file pattern DOES exist (10+ jsonl files with 54+ iterations total in the last 7d).

The existing `scripts/stability-number.mjs` already reads from the correct source (experiment-store), so the task's original framing was solving the wrong problem. This plan ships against the real data source. The `orchestrate.jsonl` heartbeat is a separate signal (10h-uptime) and remains its own thing — out of scope here.

## Scope (in)

- **New `scripts/stability-report.mjs`** with `--window=<10h|24h|7d|30d>` (multi-value: `--window=10h --window=7d` accepted), `--json` output mode, `--host-dir <path>` for non-cwd hosts. Reads `experiment-store/cross-repo/*.jsonl` (same source as the existing `stability-number.mjs`). **Output is ALWAYS a JSON array**, even for single-window requests, with one element per window. Each element: `{window: <label>, successful: N, total: M, ratio: <decimal 0.0–1.0>, generated_at: <iso>, source: "experiment-store"}`. **Window ordering**: the array preserves the order the windows were supplied on the CLI; if none specified, canonical order is `[10h, 24h, 7d, 30d]`. **`ratio` is a decimal 0.0–1.0** (not a percentage 0–100). Single-window mode (`--window=7d`) returns `[{window: "7d", ratio: 0.09, ...}]` — a one-element array.
- **New `scripts/fleet-stability-report.mjs`** that takes a list of host dirs (CLI args `--host <path>` repeatable, or env-var `MINSKY_FLEET_HOSTS=path1:path2:...`), runs the same `computeStabilityForWindow` helper against each host, and aggregates. **Output shape**: `{hosts: [{host: <path>, windows: [{window, successful, total, ratio (decimal 0.0–1.0)}, ...]}, ...], fleet: {window_summary: [{window, successful_sum, total_sum, ratio (decimal 0.0–1.0)}, ...], host_count: N}}`. **`window_summary` ordering**: same rule as `stability-report.mjs` — preserves CLI order, canonical `[10h, 24h, 7d, 30d]` if none specified. **`ratio` is always decimal 0.0–1.0**, never a percentage. **Exit code**: 0 if at least one host returned valid data; 1 if all hosts failed or no hosts were provided. Missing host emits a per-host `{host: <path>, error: "host-not-found"}` entry, excluded from the aggregate `successful_sum`/`total_sum`. Per the task's Pivot, v1 uses the **shared-filesystem** path only — each host is a directory we can read from. Git-sync and HTTP modes are deferred.
- **`scripts/collect-metrics.mjs` integration** — its `collectLoopUptime` function gets replaced (the proxy-metric "active days" path retired) with a delegation to `stability-report.mjs --window=30d`. `mttr` stays a stub for now (it genuinely needs OTEL; this task doesn't cover it).
- **METRICS.md update** — `loop-uptime` carries a real observation; the "(proxy)" disclaimer goes away. The freshness budget stays 7d.
- **Backwards compatibility**: keep `scripts/stability-number.mjs` as a thin wrapper that calls `stability-report.mjs --window=7d` so `bin/minsky status` (which already shows the stability line) doesn't break.
- **Paired tests** for both new scripts: `stability-report.test.mjs` (multi-window cases, edge cases for missing/empty data, JSON shape) and `fleet-stability-report.test.mjs` (multi-host aggregation, missing-host handling). Reuse the `makeFixtureHost` helper from `stability-number.test.mjs`.
- **Add `vision.md` pattern-conformance row** for the new scripts (rule #8): pattern is "SLI/SLO measurement" (Beyer SRE 2016, Ch. 4 — define an SLI, measure ratio over a window).

## Scope (out, deferred to follow-up tasks)

- **Git-sync mode for fleet aggregation**: each host commits `.minsky/stability-snapshot.json` to a shared remote; the aggregator pulls and reads. Deferred to `fleet-stability-git-sync-mode` (P1, M2). The shared-filesystem mode in v1 covers the single-operator-many-machines case via NFS / iCloud / Dropbox.
- **HTTP endpoint mode**: a tiny daemon on each host exposes `GET /stability.json`; the aggregator fans out HTTP calls. Deferred to `fleet-stability-http-mode` (P2, M3). Significantly larger scope (auth, TLS, supervised process).
- **`mttr` real measurement**: requires OTEL backend spans; out of scope here, the task block calls it out separately as an M1 gap.
- **`orchestrate.jsonl` 10h-uptime metric**: the Opus orchestrator heartbeat ledger is its own signal (tick health, not iteration outcomes). The `loop-uptime` METRICS.md entry COULD eventually combine both signals, but for v1 we ship iteration-success ratio only — the larger and more useful signal.
- **Stability dashboarding / TUI panel**: the scorecard plan (`self-metrics-competitive-benchmark`) covers the rendering layer. This task ships the JSON producer; that task consumes it.

## Implementation steps

Three commits, each one-PR-sized but bundled into a single PR since they're tightly coupled (the consumer can't merge without the producer).

### Step 1: Create `scripts/stability-report.mjs` + paired test

- Refactor the inner logic of `stability-number.mjs` into an exported pure function `computeStabilityForWindow({records, windowMs, now})` → `{successful, total, ratio}`. Place it in a small helper module `scripts/lib/stability.mjs` so both scripts (number and report) import it. Keep the helper pure — no I/O.
- Write `scripts/stability-report.mjs` that:
  - Parses `--window=<10h|24h|7d|30d>` (repeatable), `--json`, `--host-dir <path>`, `--now <iso>` (for tests).
  - Default windows when none specified: all four (`10h`, `24h`, `7d`, `30d`).
  - Reads every jsonl file under `<host-dir>/.minsky/experiment-store/cross-repo/`.
  - For each window, calls `computeStabilityForWindow`. Emits a result array `[{window: "10h", ...}, {window: "24h", ...}, ...]`.
  - `--json` prints the array as JSON; default mode prints a human-readable table.
  - Missing data: same behavior as today's `stability-number.mjs` (emit `{stability_pct: null, source: "no-data" | "no-recent-data"}` for that window; never crash).
- Write `scripts/stability-report.test.mjs` covering:
  - Single-window invocation (`--window=7d`) returns same numbers as current `stability-number.mjs` (regression test).
  - Multi-window invocation returns one row per window in the requested order.
  - Default-windows (no `--window` flag) returns all four.
  - Empty experiment-store → all windows return `stability_pct: null` with source `no-data`.
  - Only-old records (older than 30d) → all windows return `null` with source `no-recent-data`.
  - `--host-dir` overrides cwd correctly.
  - `--now <iso>` works for deterministic time-window testing.
- Refactor `stability-number.mjs` to import the shared helper `scripts/lib/stability.mjs` directly (NOT shell out to `stability-report.mjs` — that would add ~100ms of subprocess overhead to every `bin/minsky status` invocation). The script's PUBLIC OUTPUT FORMAT stays identical: `{stability_pct: <integer 0–100>, successful: N, total: M, window: "7d", source: "experiment-store" | "no-data" | "no-recent-data"}`. The existing test (`stability-number.test.mjs`) continues to pass without modification — it asserts the object shape and integer field, both preserved. The `stability_pct` field is computed as `Math.round(ratio * 100)` to match today's behavior exactly.
- Verify: `pnpm vitest run scripts/stability-report.test.mjs scripts/stability-number.test.mjs` all green.

### Step 2: Create `scripts/fleet-stability-report.mjs` + paired test

- Parses `--host <path>` (repeatable) OR reads `MINSKY_FLEET_HOSTS=path1:path2:...` env. If neither, defaults to the single current host.
- For each host, runs the same `computeStabilityForWindow` helper against that host's `.minsky/experiment-store/cross-repo/`.
- Aggregates: sum `successful` and `total` across all hosts, recompute `ratio = sum_successful / sum_total`.
- Output shape: `{hosts: [{host: "<path>", windows: [{window, successful, total, ratio}, ...]}, ...], fleet: {window_summary: [{window, successful_sum, total_sum, ratio}, ...], host_count: N}}`.
- Missing host (path doesn't exist) → emit per-host `error: "host-not-found"` line, exclude from aggregate, continue.
- Write `scripts/fleet-stability-report.test.mjs`:
  - Three-host fixture: A=10/10 (100%), B=5/10 (50%), C=0/10 (0%) → fleet aggregate 15/30 (50%).
  - One-host fixture: behaves identically to per-host `stability-report.mjs`.
  - Missing-host fixture: excludes the bad host, returns warning + per-host error, doesn't crash.
  - Empty env-var → falls back to cwd (single-host mode).
- Verify: `pnpm vitest run scripts/fleet-stability-report.test.mjs` green.

### Step 3: Wire into METRICS.md collection + update `vision.md` + add to `verify`

- Update `scripts/collect-metrics.mjs`'s imports: add `execFileSync` to the `node:child_process` import line (currently only `execSync` is imported there). Then replace the current activity-days-based `collectLoopUptime` implementation (lines 39-51) with:

  ```javascript
  function collectLoopUptime() {
    // Try the real measurement first: iteration-success ratio over 30d
    // from the experiment-store via `scripts/stability-report.mjs`.
    try {
      const result = execFileSync(
        "node",
        ["scripts/stability-report.mjs", "--window=30d", "--json"],
        { encoding: "utf8", timeout: 5_000 },
      );
      const parsed = JSON.parse(result);
      // Array; --window=30d alone returns a one-element array. .[0] is the 30d entry.
      const row = parsed[0];
      if (row.ratio !== null) {
        const pct = Math.round(row.ratio * 100);
        return {
          value: `${pct}% (${row.successful}/${row.total} validated iterations over 30d)`,
          source: "scripts/stability-report.mjs",
          formula:
            "node scripts/stability-report.mjs --window=30d --json | jq '.[0].ratio * 100'",
        };
      }
    } catch {
      // Fall through to the proxy below.
    }
    // Fallback: active-days proxy (today's behavior — reuses the existing
    // `runNum()` helper in collect-metrics.mjs, NOT a new helper). Marked
    // as "fallback" so the operator sees this is not the real number.
    const activeDays = runNum(
      `git log --since="30 days ago" --format="%ad" --date=format:"%Y-%m-%d" | sort -u | wc -l`,
    );
    if (activeDays === null) {
      return { value: "(stub) — no iteration data and no git history", source: "no-data" };
    }
    return {
      value: `${Math.round((activeDays / 30) * 100)}% active days (${activeDays}/30d) — fallback proxy; experiment-store has no recent data`,
      source: "scripts/collect-metrics.mjs (fallback: active-days proxy)",
      formula: 'git log --since="30 days ago" --format="%ad" --date=format:"%Y-%m-%d" | sort -u | wc -l',
    };
  }
  ```

  This reuses the existing `runNum()` helper already in `collect-metrics.mjs` (no new helpers introduced). The only new import is `execFileSync`.

  The exact jq path for the formula is `.[0].ratio * 100` because `--window=30d` alone returns a one-element array with the 30d entry at index 0 (per the array-shape rule in Scope (in) Step 1).

- Update `METRICS.md` `loop-uptime` entry. The new exact text (replacing lines 7-13):

  ```markdown
  ## loop-uptime — Loop uptime (iteration-success ratio), 30d

  _Updated: <iso> · Budget: 7d · Source: `scripts/stability-report.mjs`_

  **Value:** <N>% (<successful>/<total> validated iterations over 30d). If the experiment-store has no recent data, falls back to the active-days proxy and the value field carries a "fallback proxy" marker.

  Formula: `node scripts/stability-report.mjs --window=30d --json | jq '.[0].ratio * 100'`
  ```

- Update `METRICS.md` `mttr` entry. The new exact text (replacing lines 47-53):

  ```markdown
  ## mttr — Mean time to recovery (MTTR)

  _Budget: 1d_

  **Value:** (stub) — requires OTEL backend for supervisor restart-to-claim latency spans (M1 gap, separate task). Manual proxy in the meantime: `node scripts/stability-report.mjs --window=24h --json | jq '.[0]'` shows the most-recent-24h iteration outcomes; sustained low ratios indicate the loop is not recovering well from failures.

  Formula: `histogram_quantile(0.95, supervisor_restart_to_claim_latency_seconds[7d])`
  ```

- Add a row to `vision.md` § "Pattern conformance index" for `scripts/stability-report.mjs` + `scripts/fleet-stability-report.mjs` — pattern: SLI/SLO measurement (Beyer et al. 2016, *Site Reliability Engineering*, Ch. 4); conformance: full.
- Wire `pnpm metrics:collect` (existing script) into the `npm run verify` gate (already wired today; just confirm it still passes after the `loop-uptime` change).
- Verify: `pnpm metrics:collect && cat .minsky/metric-snapshots/<today>.json | jq '."loop-uptime".value'` returns the new real number; `npm run verify` green.

## Risks and mitigations

- **Risk: `stability-report.mjs` returns null for windows with insufficient data, breaking `collect-metrics.mjs` if it doesn't handle null.**
  - Mitigation: the integration in Step 3 explicitly checks for null and falls back to the old "active days" proxy with a clear "(fallback: insufficient iteration data)" disclaimer. Real number when we have it; proxy when we don't; never a silent zero (per minsky's stub-vs-real discipline).

- **Risk: fleet aggregation arithmetic is wrong** (e.g., averaging ratios instead of summing successful/total).
  - Mitigation: the test fixture in Step 2 explicitly covers this — three hosts with different ratios (100%, 50%, 0%) → naive average would be 50%; correct sum is `(10+5+0) / (10+10+10) = 15/30 = 50%`. The test asserts the sum path, not the average. They happen to be the same in this fixture, so add a second fixture: A=10/10, B=5/100 → naive average is `(100 + 5) / 2 = 52.5%`; correct sum is `15/110 = 13.6%`. The test asserts 13.6%.

- **Risk: 30d window picks up stale data from before a major refactor**, painting a misleading picture.
  - Mitigation: shipping all four windows (10h, 24h, 7d, 30d) in the report lets the operator see the trend. If 30d says 40% but 24h says 90%, the operator knows things just improved. METRICS.md publishes the 30d window; the script supports all four for manual inspection.

- **Risk: shared-filesystem fleet mode is fragile across host boundaries** (different filesystem permissions, missing dirs, symlink loops).
  - Mitigation: the per-host error handling in Step 2 (emit `error: "host-not-found"` and continue) means one bad host doesn't crash the aggregator. The aggregator's exit code is 0 if at least one host succeeded.

- **Risk: regression on `bin/minsky status`** — that command currently parses `stability-number.mjs` output for the "Stability: N%" line.
  - Mitigation: Step 1's refactor makes `stability-number.mjs` a thin wrapper around `stability-report.mjs --window=7d`. The output format stays identical. The existing test (`stability-number.test.mjs`) is the regression guard.

- **Risk: vendor naming in the metric name** ("loop-uptime" implies a specific orchestrator). Constitutional rule #1 says no vendor names in business logic.
  - Mitigation: "loop-uptime" is the existing METRICS.md key; renaming it is a separate-PR breaking change (other scripts and docs reference it). Keep the key, swap the formula. If we later want to rename for clarity, file a separate task.

- **Risk: scope leak.** Three commits touching scripts, METRICS.md, vision.md, and a new lib module.
  - Mitigation: each commit stages ONLY the files in its step's list. TASKS.md hygiene (this plan + the closing of the parent task) goes in a separate `chore:` commit at the end.

## Acceptance criteria

1. `scripts/stability-report.mjs` exists, executable, and `node scripts/stability-report.mjs --window=10h --window=24h --window=7d --window=30d --json` returns a JSON array with 4 entries. Verifiable: `node scripts/stability-report.mjs --window=10h --window=24h --window=7d --window=30d --json | jq 'length'` returns `4`.
2. The single-window invocation matches the existing 7d number. Verifiable: `diff <(node scripts/stability-number.mjs --json | jq '.stability_pct') <(node scripts/stability-report.mjs --window=7d --json | jq '(.[0].ratio * 100) | floor')`. (`floor` is used instead of `round` because the wrapper computes `stability_pct = Math.round(ratio * 100)` in JS, and the jq side mirrors that with `floor` after the round trip. The values match because `stability_pct` is already a stored integer in the JSON output.)
3. `scripts/fleet-stability-report.mjs` exists and aggregates correctly across hosts. Verifiable: against a three-host fixture (A=10/10, B=5/100), `node scripts/fleet-stability-report.mjs --host A --host B --json | jq '.fleet.window_summary[0].ratio'` returns `0.136` (±0.001).
4. `pnpm vitest run scripts/stability-report.test.mjs scripts/fleet-stability-report.test.mjs scripts/stability-number.test.mjs` exits 0 with ≥10 new tests across the two new test files.
5. `METRICS.md` `loop-uptime` entry no longer contains "(proxy)" or "active days". Verifiable: `grep -E "loop-uptime|proxy|active days" METRICS.md` shows only the new entry; no stale text.
6. `pnpm metrics:collect` emits a real `loop-uptime` number (not the active-days proxy) when iteration data is present. Verifiable: `pnpm metrics:collect && jq '."loop-uptime".source' .minsky/metric-snapshots/<today>.json` returns `"scripts/stability-report.mjs"`.
7. `vision.md` § "Pattern conformance index" has a new row citing Beyer SRE 2016 Ch. 4 for the new scripts (rule #8). Verifiable: `grep -c "stability-report" vision.md` returns ≥1.
8. `npm run verify` (full gate) is green on the PR.

## Workflow gate (precondition for first code commit)

Per the `/next-task` "Plan and validate" workflow shipped earlier this session, no commit to any of the listed files may land until this plan file contains a `## Reviewer verdict` section whose LAST `**Verdict**:` line is `approved`:

```bash
awk '/^## Reviewer verdict$/,0' docs/plans/fleet-stability-centralized-reporting.md \
  | grep '^- \*\*Verdict\*\*:' | tail -1 | grep -q approved
```

If the gate fails, the implementing agent halts and either re-runs the reviewer subagent or escalates to the operator.

## Reviewer verdict

### Round 1 (2026-05-20, pre-revision)

- **Verdict**: needs-revision
- **Reviewer**: reviewer-subagent (round 1)
- **Date**: 2026-05-20
- **Concerns** (each addressed in post-revision plan):
  1. Acceptance criterion 2 had a shape mismatch — `stability-number.mjs` outputs an object with `stability_pct`, `stability-report.mjs` outputs an array with `ratio`. Fixed by specifying array-always shape + decimal-0.0–1.0 ratio in Scope (in) Step 1 (line 41).
  2. Step 2 output shape and aggregation arithmetic ambiguous — ratio decimal-vs-percentage and window ordering not specified; exit code not in the spec. Fixed by explicit spec in Scope (in) Step 2 (line 42).
  3. Step 3 integration incomplete — exact jq path, exact `collectLoopUptime` code path, exact METRICS.md text for both `loop-uptime` and `mttr` were not provided. Fixed by inlining the full code block and the full METRICS.md replacement text in Implementation Step 3 (lines 98-161).

### Round 2 (2026-05-20, after round-1 revisions)

- **Verdict**: needs-revision
- **Reviewer**: reviewer-subagent (round 2)
- **Date**: 2026-05-20
- **All 3 round-1 concerns**: addressed.
- **New concerns introduced by round-1 revisions** (each addressed in round-2 revision):
  1. Missing `execFileSync` import — fixed by line 98 explicitly calling out the import addition.
  2. Undefined `countActiveDays` helper — fixed by using the existing `runNum()` pattern with the git command inlined (lines 128-130). No new helper introduced.
  3. Fallback implementation mismatch — same root cause; resolved by the `runNum()` reuse.
  4. jq `round` portability — fixed by switching to `floor` (line 199) with rationale documented.

### Round 3 (2026-05-20, after round-2 revisions)

- **Verdict**: approved
- **Reviewer**: reviewer-subagent (round 3)
- **Date**: 2026-05-20
- **All 4 round-2 concerns**: addressed.
- **New concerns introduced by round-2 revisions**: none. All revisions are internal documentation polish — explicit import note, reuse of existing `runNum()` pattern, portable jq syntax. No new code paths, no new dependencies, no new helpers.
- **Approval rationale**: The plan now specifies exactly which import to add, reuses the existing `runNum()` helper pattern (eliminating the undefined-helper risk), keeps fallback implementation consistent with the existing collect-metrics.mjs style, and uses portable jq syntax. The 3 steps are each one-commit-sized with concrete file lists. All 8 acceptance criteria are deterministically verifiable.

**Workflow gate satisfied**: this plan now contains `**Verdict**: approved` as its final reviewer-verdict status. Per the `/next-task` "Plan and validate" rule, implementation may proceed.
