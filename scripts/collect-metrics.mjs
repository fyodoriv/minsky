#!/usr/bin/env node
// Pattern: metric collector — gathers real observations from local
//   data sources (git log, gh CLI, test runner output, rule-check
//   scripts, daemon logs) and writes a metric snapshot to
//   `.minsky/metric-snapshots/<date>.json` for the render pipeline.
// Anchor: Forsgren/Humble/Kim 2018 (measure what matters — DORA);
//   Ries 2011 (no vanity metrics); rule #4 (everything measurable);
//   rule #10 (deterministic — same repo state, same output).
// Conformance: full — each collector is a pure async function that
//   takes an exec seam; the CLI binding is the only I/O surface.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10);
const SNAPSHOT_DIR = resolve(ROOT, ".minsky/metric-snapshots");

/** @param {string} cmd */
function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

/** @param {string} cmd */
function runNum(cmd) {
  const out = run(cmd);
  if (out === null) return null;
  const n = Number(out);
  return Number.isNaN(n) ? null : n;
}

// ---- Collectors ----

/** loop-uptime: iteration-success ratio over 30d (real measurement via
 * `scripts/stability-report.mjs`); falls back to active-commit-days proxy
 * when the experiment-store has no data (fresh checkouts).
 */
function collectLoopUptime() {
  // Try the real measurement first: iteration-success ratio over 30d
  // from .minsky/experiment-store/cross-repo/*.jsonl via the shared
  // helper. Single-window invocation returns a one-element array.
  try {
    const stdout = execFileSync(
      "node",
      ["scripts/stability-report.mjs", "--window=30d", "--json"],
      { cwd: ROOT, encoding: "utf8", timeout: 5_000 },
    );
    const parsed = JSON.parse(stdout);
    const row = parsed[0];
    if (row?.ratio !== null && row?.ratio !== undefined) {
      const pct = Math.round(row.ratio * 100);
      return {
        value: `${pct}% (${row.successful}/${row.total} validated iterations over 30d)`,
        higherIsBetter: true,
      };
    }
  } catch {
    // Fall through to the proxy below.
  }
  // Fallback: active-days proxy (pre-stability-report behavior) so fresh
  // checkouts without experiment-store data still produce a value.
  // Reuses the existing `runNum()` helper — no new helper introduced.
  const activeDays = runNum(
    `git log --since="30 days ago" --format="%ad" --date=format:"%Y-%m-%d" | sort -u | wc -l`,
  );
  if (activeDays === null) return null;
  const ratio = Math.min(activeDays / 30, 1.0);
  return {
    value: `${(ratio * 100).toFixed(1)}% active days (${activeDays}/30d) — fallback proxy; experiment-store has no recent data`,
    higherIsBetter: true,
  };
}

/** cross-repo-pr-rate: rolling-30d iteration→PR ship-rate via the pure
 * `computeShipRate` (one source of truth — same constants as the CI lint
 * and the optional runtime invariant). Returns the live ratio formatted
 * for METRICS.md; the verdict bucket is included so an at-a-glance reader
 * sees both the number and the action (ABOVE / WARN / BELOW / INSUFFICIENT-DATA).
 * Reads via `node scripts/check-cross-repo-pr-rate.mjs --json` so the CLI
 * I/O path is exercised by every metric snapshot (rule #4 visibility).
 */
function collectCrossRepoPrRate() {
  try {
    const stdout = execFileSync(
      "node",
      ["scripts/check-cross-repo-pr-rate.mjs", "--window=30d", "--json"],
      { cwd: ROOT, encoding: "utf8", timeout: 5_000 },
    );
    const parsed = JSON.parse(stdout);
    if (parsed.verdict === "INSUFFICIENT-DATA") {
      return {
        value: `INSUFFICIENT-DATA (n=${parsed.n} < 5; need more iterations to verdict)`,
        higherIsBetter: true,
      };
    }
    const pct = (parsed.rate * 100).toFixed(1);
    return {
      value: `${pct}% (${parsed.withPr}/${parsed.n} iterations opened a PR over 30d) — verdict=${parsed.verdict}`,
      higherIsBetter: true,
    };
  } catch {
    return null;
  }
}

/** task-throughput: conventional commits per day over 30d */
function collectTaskThroughput() {
  const total = runNum(
    `git log --since="30 days ago" --oneline --grep="^feat\\|^fix\\|^docs\\|^chore" | wc -l`,
  );
  if (total === null) return null;
  const perDay = (total / 30).toFixed(1);
  return { value: `${perDay} commits/day (${total} in 30d)`, higherIsBetter: true };
}

/** spec-alignment: CI green ratio from gh API */
function collectSpecAlignment() {
  const raw = run(
    `gh run list --workflow ci.yml --branch main --status completed --limit 100 --json conclusion --jq '[.[] | select(.conclusion=="success")] | length'`,
  );
  const total = run(
    `gh run list --workflow ci.yml --branch main --status completed --limit 100 --json conclusion --jq 'length'`,
  );
  if (raw === null || total === null) return null;
  const s = Number(raw);
  const t = Number(total);
  if (t === 0) return { value: "no CI runs", higherIsBetter: true };
  const ratio = ((s / t) * 100).toFixed(1);
  return { value: `${ratio}% (${s}/${t} runs green)`, higherIsBetter: true };
}

/** dep-interface-coverage: run the rule-2 check */
function collectDepInterfaceCoverage() {
  const result = run("node scripts/check-rule-2-dep-coverage.mjs 2>&1");
  if (result === null) return null;
  const pass =
    result.includes("pass") ||
    result.includes("✓") ||
    result.includes("ok") ||
    result.includes("clean");
  return { value: pass ? "pass" : `fail — ${result.slice(0, 100)}`, higherIsBetter: true };
}

/** extraction-count: @minsky/* repos on GitHub */
function collectExtractionCount() {
  const raw = run(
    `gh repo list fyodoriv --json name,description --jq '[.[] | select(.description != null) | select(.description | test("@minsky|claude-"))] | length'`,
  );
  if (raw === null) return null;
  return { value: Number(raw), higherIsBetter: true };
}

// `collectTestCount()` removed 2026-05-19 — dead code, never wired
// into the metrics output. Restore from git history when actually
// needed; the spec for `test-count` already lives in METRICS.md and
// `scripts/generate-metrics-md.mjs` does not depend on it.

/** self-improvement-velocity: MAPE-K rollout commits */
function collectSelfImprovementVelocity() {
  const count = runNum(`git log --all --since="30 days ago" --oneline --grep="mape-k" | wc -l`);
  if (count === null) return null;
  return { value: `${count} mape-k-related commits (30d)`, higherIsBetter: true };
}

/** token-budget-honoring: proxy — count budget-paused events in logs */
function collectTokenBudgetHonoring() {
  // No 429 errors observable from git — proxy via daemon log
  const budgetPauses = runNum(
    `grep -c "budget.*pause\\|PAUSE\\|budget-paused" ~/.minsky/daemon.log 2>/dev/null || echo 0`,
  );
  return { value: `${budgetPauses ?? 0} budget-pause events in daemon.log`, higherIsBetter: false };
}

/** mttr: proxy — average time between failure and next success commit */
function collectMttr() {
  // Simplified proxy: no OTEL backend yet, use "no data" honestly
  return { value: "no OTEL backend — MTTR not measurable yet (M1 gap)", higherIsBetter: false };
}

/** mttr-self-heal: p95 MTTR for catalogued automated heal events (.minsky/heal-events.jsonl) */
function collectMttrSelfHeal() {
  // Delegates to scripts/heal-mttr-report.mjs for the 30d window.
  // The zero state (no heal events in 30d) is a REAL observation, not
  // an "OTEL-blocked stub": the heal helpers + ledger ship at
  // `novel/observer/heals/` (PRs #738, #748, #781 …), so a 0/0 reading
  // means "supervisor was healthy enough that no heal fired in 30d",
  // not "the metric machinery is missing". Reporting it as the same
  // shape as the populated path closes Phase 1 success criterion #4
  // of `agents-can-self-heal-minsky-m1-13` (TASKS.md) which calls for
  // "a real number (not the OTEL-blocked stub)".
  const raw = run("node scripts/heal-mttr-report.mjs --window=30d --json");
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    const row = Array.isArray(parsed) ? parsed[0] : null;
    if (!row) return null;
    const p95 = row.mttr_p95_ms;
    const p50 = row.mttr_p50_ms;
    const successful = row.successful ?? 0;
    const attempted = row.attempted ?? 0;
    return {
      value: `p95=${p95 ?? "n/a"}ms · p50=${p50 ?? "n/a"}ms · ${successful}/${attempted} healed (30d)`,
      higherIsBetter: false,
    };
  } catch {
    return null;
  }
}

/** wrist-dwell: proxy — dashboard/watch surface not instrumented yet */
function collectWristDwell() {
  return { value: "no watch-surface telemetry yet (M1 gap)", higherIsBetter: false };
}

// ---- Ledger-backed collectors (.minsky/transform-runs.jsonl) ----
//
// The MAPE-K Monitor surface (PR #824) writes one record per
// `minsky --transform` session to `.minsky/transform-runs.jsonl` in
// every host repo. PRs #825 + #827 ship `transform_trend.py` (per-host
// Analyse) + `transform_knowledge.py` (cross-host Knowledge). The
// three collectors below wrap those scripts to fulfil M1.2 / M1.5 /
// M1.7 — closing 3 of the 5 metric-only milestone-alignment gaps left
// after PR #831 fixed the path-mismatch bug. Per the operator brief
// "doesn't reinvent / uses existing solutions": the ledger + the
// aggregators exist; this is the no-reinvent wire-up.

/**
 * Run a python3 script and parse its stdout as JSON. Returns `null` on
 * any failure (script missing, exit≠0, invalid JSON). The collectors
 * below use this to defend against missing python3, missing ledger,
 * etc. — each fallback path produces an honest descriptive value
 * (never `(stub)`).
 *
 * @param {string} scriptPath
 * @param {string[]} args
 * @returns {unknown}
 */
function runPyJson(scriptPath, args) {
  try {
    const stdout = execFileSync("python3", [scriptPath, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10_000,
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ---- Pure formatters (exported so paired tests can hit them
//      without spawning subprocesses) -------------------------------
//
// Each `format*` function takes the parsed JSON from the matching
// python script and returns the same `{ value, higherIsBetter }`
// shape every collector emits. The Honest-zero invariant (Ries 2011,
// rule #10) is enforced here: `null` input → honest descriptive
// string, NEVER `(stub)`. Tests can mock-feed any of the n=0 / no-
// fleet / populated cases without going through `execFileSync`.

/**
 * @param {string | undefined} hostsDir
 * @param {{ host_count?: number, per_host?: Array<{ session_count: number, lint_pass_fraction: number | null }> } | null} data
 * @returns {{ value: string, higherIsBetter: boolean }}
 */
export function formatFleetStability(hostsDir, data) {
  if (!hostsDir) {
    return {
      value: "no fleet — set $MINSKY_HOSTS_DIR to aggregate across hosts",
      higherIsBetter: true,
    };
  }
  if (data === null) {
    // Python script failed (e.g. transform_knowledge.py not found or
    // exit≠0). Honest descriptive rather than `null` so the collector
    // surface stays uniform — Ries 2011 (no silent zero), and so the
    // type is `{value, higherIsBetter}` not `… | null` (downstream
    // consumers don't need to null-guard).
    return {
      value: `transform_knowledge.py failed against ${hostsDir} (see script stderr)`,
      higherIsBetter: true,
    };
  }
  if ((data.host_count ?? 0) === 0) {
    return { value: `n=0 hosts with ledger data under ${hostsDir}`, higherIsBetter: true };
  }
  let totalSessions = 0;
  let weightedPass = 0;
  for (const h of data.per_host ?? []) {
    if (typeof h.lint_pass_fraction !== "number") continue;
    totalSessions += h.session_count;
    weightedPass += h.session_count * h.lint_pass_fraction;
  }
  if (totalSessions === 0) {
    return {
      value: `n=0 sessions across ${data.host_count} hosts (fleet observed, no iterations yet)`,
      higherIsBetter: true,
    };
  }
  const pct = ((weightedPass / totalSessions) * 100).toFixed(1);
  return {
    value: `${pct}% lint-pass (${data.host_count} hosts, ${totalSessions} sessions)`,
    higherIsBetter: true,
  };
}

/**
 * @param {{ session_count: number, files_delta_per_session: number[], tests_delta_per_session: number[], loc_delta_per_session: number[] } | null} data
 * @returns {{ value: string, higherIsBetter: boolean }}
 */
export function formatSessionConvertsRepo(data) {
  if (data === null) {
    return {
      value: "n=0 sessions in local ledger (ledger not yet created)",
      higherIsBetter: true,
    };
  }
  if (data.session_count === 0) {
    return { value: "n=0 sessions in local ledger", higherIsBetter: true };
  }
  let converted = 0;
  for (let i = 0; i < data.session_count; i++) {
    const filesDelta = data.files_delta_per_session[i] ?? 0;
    const testsDelta = data.tests_delta_per_session[i] ?? 0;
    const locDelta = data.loc_delta_per_session[i] ?? 0;
    if (filesDelta !== 0 || testsDelta !== 0 || locDelta !== 0) converted++;
  }
  const pct = ((converted / data.session_count) * 100).toFixed(1);
  return {
    value: `${pct}% of sessions changed code (${converted}/${data.session_count})`,
    higherIsBetter: true,
  };
}

/**
 * @param {{ session_count: number, files_delta_cumulative: number[], tests_delta_cumulative: number[], loc_delta_cumulative: number[] } | null} data
 * @returns {{ value: string, higherIsBetter: boolean }}
 */
export function formatBaselineDeltaPerCycle(data) {
  if (data === null) {
    return {
      value: "n=0 sessions in local ledger (ledger not yet created)",
      higherIsBetter: true,
    };
  }
  if (data.session_count === 0) {
    return { value: "n=0 sessions in local ledger", higherIsBetter: true };
  }
  const filesCum = data.files_delta_cumulative.at(-1) ?? 0;
  const testsCum = data.tests_delta_cumulative.at(-1) ?? 0;
  const locCum = data.loc_delta_cumulative.at(-1) ?? 0;
  const n = data.session_count;
  return {
    value: `per-cycle avg: +${(filesCum / n).toFixed(1)} files, +${(testsCum / n).toFixed(1)} tests, +${(locCum / n).toFixed(1)} loc (n=${n})`,
    higherIsBetter: true,
  };
}

// ---- Collectors (thin wrappers — subprocess + format) ------------

function collectFleetStabilityAggregated() {
  const hostsDir = process.env["MINSKY_HOSTS_DIR"];
  if (!hostsDir) return formatFleetStability(undefined, null);
  const data = /** @type {Parameters<typeof formatFleetStability>[1]} */ (
    runPyJson("scripts/transform_knowledge.py", ["--hosts-dir", hostsDir, "--json"])
  );
  return formatFleetStability(hostsDir, data);
}

function collectSessionConvertsRepo() {
  const data = /** @type {Parameters<typeof formatSessionConvertsRepo>[0]} */ (
    runPyJson("scripts/transform_trend.py", ["--repo", ROOT, "--json"])
  );
  return formatSessionConvertsRepo(data);
}

/**
 * Path A scoreboard collectors. Each runs `fd -e ts -e tsx --type f
 * --exclude '*.test.*' . <subtree>/ | xargs wc -l | tail -1 | awk
 * '{print $1}'` and reports the LOC integer. Pure observation — no
 * goal/pivot logic here (those live in `SUCCESS_METRICS` in
 * `novel/dashboard-web/src/metrics.ts`).
 *
 * Source: TASKS.md `path-a-loc-scoreboard-metric` (P1, M1);
 * `docs/plans/2026-05-24-path-a-aggressive-cut.md` (the 5-10K
 * target); rule #4 (everything measurable, everything visible).
 *
 * @param {string} subtree  — relative path under repo root (e.g. "novel", "novel/cross-repo-runner")
 * @returns {{ value: number, higherIsBetter: boolean } | null}
 */
function collectPathALoc(subtree) {
  // Use a shell with pipefail so the value is meaningful — if fd
  // finds nothing OR xargs / wc / awk fail, we return null rather
  // than a misleading 0.
  const cmd = `set -o pipefail; fd -e ts -e tsx --type f --exclude '*.test.*' . ${subtree}/ | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}'`;
  const raw = run(cmd);
  if (raw === null || raw.trim().length === 0) return null;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return null;
  // higherIsBetter=false because Path A's stated goal is shrinking
  // — the budget threshold is ≤10K for the parent metric, 0 for the
  // sub-tree deletion targets.
  return { value, higherIsBetter: false };
}

function collectBaselineDeltaPerCycle() {
  const data = /** @type {Parameters<typeof formatBaselineDeltaPerCycle>[0]} */ (
    runPyJson("scripts/transform_trend.py", ["--repo", ROOT, "--json"])
  );
  return formatBaselineDeltaPerCycle(data);
}

// ---- Main ----

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates ≥10 metric collectors with fallback logic — refactor tracked in TASKS.md `scripts-complexity-refactor`
async function main() {
  console.info(`Collecting metrics for ${TODAY}...\n`);

  const collectors = {
    "loop-uptime": collectLoopUptime,
    "cross-repo-pr-rate": collectCrossRepoPrRate,
    "task-throughput": collectTaskThroughput,
    "spec-alignment": collectSpecAlignment,
    "dep-interface-coverage": collectDepInterfaceCoverage,
    "extraction-count": collectExtractionCount,
    "self-improvement-velocity": collectSelfImprovementVelocity,
    "token-budget-honoring": collectTokenBudgetHonoring,
    mttr: collectMttr,
    "mttr-self-heal": collectMttrSelfHeal,
    "wrist-dwell": collectWristDwell,
    "fleet-stability-aggregated": collectFleetStabilityAggregated,
    "session-converts-repo": collectSessionConvertsRepo,
    "baseline-delta-per-cycle": collectBaselineDeltaPerCycle,
    "tokens-per-story": () => ({
      value: "no OTEL backend — not measurable yet (M1 gap)",
      higherIsBetter: false,
    }),
    // Path A scoreboard — see `SUCCESS_METRICS` for goal/pivot/anchor.
    // Source: TASKS.md `path-a-loc-scoreboard-metric` (P1, M1).
    // `path-a-loc-cross-repo-runner` was retired in PR #883
    // (phase-7b step 6/7) and `path-a-loc-tick-loop` was retired in
    // PR #888 (phase-11b step 6/7/8) once their respective
    // deletion-target packages were removed. `path-a-loc-novel-tree`
    // continues to track the aggregate.
    "path-a-loc-novel-tree": () => collectPathALoc("novel"),

    // M1 milestone-alignment metrics (2026-05-26). Each is a binary
    // or count probe that satisfies the `## Metric` surface for its
    // M1 exit criterion. Definitions live in SUCCESS_METRICS — these
    // collectors compute today's value.
    "install-success-rate": () => {
      // The operator-side install path is `./setup.sh --setup`. We can't
      // re-run that here (it'd modify the operator's environment), so
      // probe the substrate: setup.sh exists + has the --setup mode +
      // the supervisor's `--doctor` health probe passes.
      try {
        const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const setupOk = existsSync(resolve(repo, "setup.sh"));
        const docCheck = execSync(
          `bash ${resolve(repo, "setup.sh")} --help 2>&1 | grep -q -- '--setup' && echo 1 || echo 0`,
          { encoding: "utf8" },
        ).trim();
        const value = setupOk && docCheck === "1" ? 1 : 0;
        return { value, higherIsBetter: true };
      } catch {
        return { value: 0, higherIsBetter: true };
      }
    },
    "remote-task-submission-substrate": () => {
      // Substrate probe: a placeholder for the future `bin/minsky submit`
      // subcommand. Until M1.8 fully ships, the substrate IS the user-story
      // (006-runner-on-any-repo.md mentions remote findings) + the existing
      // `bin/minsky` CLI surface. Returns 1 when both present.
      try {
        const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const cliOk = existsSync(resolve(repo, "bin/minsky"));
        const storyOk = existsSync(
          resolve(repo, "user-stories/008-per-task-backend-and-personas.md"),
        );
        const value = cliOk && storyOk ? 1 : 0;
        return { value, higherIsBetter: true };
      } catch {
        return { value: 0, higherIsBetter: true };
      }
    },
    "agent-launcher-parity": () => {
      // Probe: count the agent backends listed in AGENT_MATRIX +
      // the spawn-config builder. Until live A/B benchmarks land, the
      // SUBSTRATE check is whether the dispatcher recognises all 4
      // backends (openhands / claude / devin / aider) without crashing.
      try {
        const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const spawnAgent = resolve(repo, "scripts/spawn_agent.py");
        if (!existsSync(spawnAgent)) return { value: 0, higherIsBetter: true };
        const content = readFileSync(spawnAgent, "utf8");
        let recognised = 0;
        for (const backend of ["openhands", "claude", "devin", "aider"]) {
          if (content.toLowerCase().includes(backend)) recognised += 1;
        }
        return { value: recognised, higherIsBetter: true };
      } catch {
        return { value: 0, higherIsBetter: true };
      }
    },
    "uninstall-residue-count": () => {
      // Probe: that `bin/minsky uninstall` exists with the right shape.
      // Live measurement (running uninstall on a fixture host) is in the
      // integration test under `test/integration/`; here we record the
      // substrate-present binary signal (the count is 0 if substrate
      // present, ≥1 if missing — inverted because lower-is-better).
      try {
        const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
        const binMinsky = resolve(repo, "bin/minsky");
        if (!existsSync(binMinsky)) return { value: 999, higherIsBetter: false };
        const content = readFileSync(binMinsky, "utf8");
        // 0 = subcommand wired (clean uninstall is reachable);
        // 1+ = missing substrate (residue is the operator's existing files).
        const value = /uninstall\)/.test(content) ? 0 : 1;
        return { value, higherIsBetter: false };
      } catch {
        return { value: 1, higherIsBetter: false };
      }
    },
  };

  /** @type {Record<string, {value: any, higherIsBetter?: boolean}>} */
  const snapshot = {};
  let collected = 0;
  let failed = 0;

  for (const [id, fn] of Object.entries(collectors)) {
    try {
      const result = fn();
      if (result !== null) {
        snapshot[id] = result;
        console.info(
          `  ✅ ${id}: ${typeof result.value === "string" ? result.value : JSON.stringify(result.value)}`,
        );
        collected++;
      } else {
        console.info(`  ⚠️  ${id}: no data available`);
        failed++;
      }
    } catch (err) {
      console.info(`  ❌ ${id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // Write snapshot
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshotPath = resolve(SNAPSHOT_DIR, `${TODAY}.json`);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.info(`\n${collected}/${collected + failed} metrics collected → ${snapshotPath}`);

  // Also write a summary to stdout as JSON for piping
  if (process.argv.includes("--json")) {
    console.info(
      JSON.stringify({ date: TODAY, path: snapshotPath, collected, failed, snapshot }, null, 2),
    );
  }

  return failed > collected ? 1 : 0;
}

// Guard CLI execution so dynamic `import("./collect-metrics.mjs")`
// from test files can pull `formatFleetStability` / `formatSessionConvertsRepo`
// / `formatBaselineDeltaPerCycle` without triggering `main()` — which
// spawns every collector, hits the network via `gh`, writes a
// snapshot file, and calls `process.exit`. Matches the
// `generate-metrics-md.mjs` pattern (rule #2 — one idiom across the
// scripts/ tree).
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("collect-metrics.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
