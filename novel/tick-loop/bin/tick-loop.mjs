#!/usr/bin/env node
// @ts-check
// <!-- pattern: not-applicable — the I/O edge ("imperative shell" over the
//   pure machine-budget-autoscaler / os-throttle-detect cores; Bernhardt 2012
//   functional-core/imperative-shell) is named in
//   novel/tick-loop/README.md § "machine-budget-autoscaler"; this file is the
//   shell half, the pattern row covers the package. -->
//
// tick-loop machine-budget driver — the I/O edge for
// `operator-machine-budget-autoscale` parts (a)/(b)/(c)/(d). Reads the
// operator budget (env → ~/.minsky/config.json → policy default), probes the
// host for budget-contradicting OS throttles, drives the PURE
// `computeWorkerTarget` controller, and prints the worker target the daemon
// should run next — replacing the old fixed `--spawn-additional-workers`
// constant that could not track the per-host saturation knee.
//
// All decision logic lives in the pure cores (`machine-budget-autoscaler`,
// `os-throttle-detect`); this file only does I/O (os/loadavg, read config,
// read the launchd plist, print). That split is what makes the controller
// deterministically testable and what the `scripts/check-machine-budget.mjs`
// gate pins.
//
// Usage:
//   node novel/tick-loop/bin/tick-loop.mjs [--json] [--last-target N]
//   MINSKY_MACHINE_BUDGET_PCT=80 MINSKY_SWARM_MODE=1 node ... --json
//
// Output (text, default): the resolved budget, the worker target + regime,
// and any throttle findings with their remediation + mirror task. `--json`
// emits the same as one machine-readable object (used by the daemon).
//
// Source: vision.md rule #15 (match the operator budget); rule #1 (propagate
//   host changes to dotfiles/agentbrew, don't hand-maintain); rule #14b
//   (dynamic settings — concurrency computed from the live host, not
//   hardcoded); Brandolini / Bernhardt functional-core-imperative-shell.

import { readFileSync } from "node:fs";
import { cpus, homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { computeWorkerTarget, resolveMachineBudgetPct } from "../dist/machine-budget-autoscaler.js";
import { detectThrottles, renderMirrorTasks } from "../dist/os-throttle-detect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/**
 * Read the per-machine `~/.minsky/config.json` `machineBudgetPct`, returning
 * `undefined` when the file or field is absent (the next budget layer wins).
 *
 * @returns {number | undefined}
 */
function readConfigBudgetPct() {
  const path = join(homedir(), ".minsky", "config.json");
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    const v = cfg?.machineBudgetPct;
    return typeof v === "number" ? v : undefined;
    // rule-6: handled-locally — a missing/garbage config is the common case
    // (fresh host); the next budget layer (policy default) is the fallback.
  } catch {
    return undefined;
  }
}

/**
 * Read the worker launchd plist's `<ProcessType>`, or `null` when the file or
 * key is absent. Linux / non-launchd hosts degrade to `null` (rule #7).
 *
 * @returns {string | null}
 */
function readWorkerProcessType() {
  const path = join(REPO_ROOT, "distribution", "launchd", "com.minsky.tick-loop.plist");
  try {
    const text = readFileSync(path, "utf8");
    const m = text.match(/<key>\s*ProcessType\s*<\/key>\s*<string>\s*([^<]*?)\s*<\/string>/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Collect stale `MINSKY_*` hard-cap env vars that would override the autoscaler. */
function readStaleMinskyCaps() {
  /** @type {Record<string, string>} */
  const caps = {};
  const v = process.env.MINSKY_SPAWN_ADDITIONAL_WORKERS;
  if (v !== undefined && v.length > 0) caps.MINSKY_SPAWN_ADDITIONAL_WORKERS = v;
  return caps;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ltIdx = args.indexOf("--last-target");
  const lastTarget = ltIdx >= 0 ? Number(args[ltIdx + 1]) : Number.NaN;

  const budgetPct = resolveMachineBudgetPct({
    envPct: process.env.MINSKY_MACHINE_BUDGET_PCT,
    configPct: readConfigBudgetPct(),
    swarmMode: process.env.MINSKY_SWARM_MODE === "1",
  });

  const cores = cpus().length;
  const load1 = loadavg()[0];

  const throttles = detectThrottles({
    budgetPct,
    processType: readWorkerProcessType(),
    staleMinskyCaps: readStaleMinskyCaps(),
  });
  const mirrorTasks = renderMirrorTasks(throttles);

  const decision = computeWorkerTarget({
    budgetPct,
    cores,
    loadAvg: load1,
    // The daemon supplies live windowed metrics; the CLI default (cold start)
    // ramps from the last target it printed.
    recentActiveSubprocs: Number.isFinite(lastTarget) ? lastTarget : 0,
    recentPrRate: 0,
    lastTargets: Number.isFinite(lastTarget) ? [lastTarget] : [],
  });

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ budgetPct, cores, loadAvg: load1, decision, throttles, mirrorTasks })}\n`,
    );
    return throttles.length > 0 ? 3 : 0;
  }

  process.stdout.write(
    `machine budget: ${budgetPct}% of ${cores} cores → worker target ${decision.target} (${decision.reason}); load1=${load1.toFixed(2)}\n`,
  );
  for (const t of throttles) {
    process.stderr.write(`throttle [${t.kind}]: ${t.detail}\n  fix: ${t.remediation}\n`);
  }
  for (const m of mirrorTasks) {
    process.stderr.write(`mirror-task → ${m.tasksMdPath}:\n${m.taskBlock}\n`);
  }
  return throttles.length > 0 ? 3 : 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("tick-loop.mjs");
if (invokedDirectly) {
  process.exit(main());
}

export { readConfigBudgetPct, readStaleMinskyCaps, readWorkerProcessType };
