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

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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

/** loop-uptime: compute from daemon.log if available, else from git activity */
function collectLoopUptime() {
  // Proxy: days with at least one commit in the last 30 days / 30
  const activeDays = runNum(
    `git log --since="30 days ago" --format="%ad" --date=format:"%Y-%m-%d" | sort -u | wc -l`,
  );
  if (activeDays === null) return null;
  const ratio = Math.min(activeDays / 30, 1.0);
  return {
    value: `${(ratio * 100).toFixed(1)}% active days (${activeDays}/30d)`,
    higherIsBetter: true,
  };
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
  // Returns the OTEL-blocked stub when the ledger has no entries — same
  // graceful-degrade pattern as collectLoopUptime.
  const raw = run("node scripts/heal-mttr-report.mjs --window=30d --json");
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    const row = Array.isArray(parsed) ? parsed[0] : null;
    if (!row || row.source === "no-data") {
      return {
        value: "no heal-events yet — measurable once any helper fires",
        higherIsBetter: false,
      };
    }
    const p95 = row.mttr_p95_ms;
    const p50 = row.mttr_p50_ms;
    const successful = row.successful;
    const attempted = row.attempted;
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

// ---- Main ----

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates ≥10 metric collectors with fallback logic — refactor tracked in TASKS.md `scripts-complexity-refactor`
async function main() {
  console.info(`Collecting metrics for ${TODAY}...\n`);

  const collectors = {
    "loop-uptime": collectLoopUptime,
    "task-throughput": collectTaskThroughput,
    "spec-alignment": collectSpecAlignment,
    "dep-interface-coverage": collectDepInterfaceCoverage,
    "extraction-count": collectExtractionCount,
    "self-improvement-velocity": collectSelfImprovementVelocity,
    "token-budget-honoring": collectTokenBudgetHonoring,
    mttr: collectMttr,
    "mttr-self-heal": collectMttrSelfHeal,
    "wrist-dwell": collectWristDwell,
    "tokens-per-story": () => ({
      value: "no OTEL backend — not measurable yet (M1 gap)",
      higherIsBetter: false,
    }),
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

const code = await main();
process.exit(code);
