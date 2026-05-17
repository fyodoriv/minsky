#!/usr/bin/env node
// <!-- scope: human-approved — task `runany-dynamic-model-or-local-fallback`
//   Measurement line. Promotes the task's three pre-registered acceptance
//   scenarios (pin / dynamic / all-down) from prose into a versioned,
//   paired-tested deterministic harness. Without it the operator can't
//   answer "does the run-anywhere model decision honor the pin / track
//   budget / fall to local when all remotes die" except by reading code. -->
// Pattern: pure scenario runners (`runPinScenario`, `runDynamicScenario`,
//   `runAllDownScenario`) parameterised by an injected `resolve` (the
//   `resolveRunAnyModel` pure decider) above a thin CLI — same shape as
//   `cto-audit-metrics.mjs` so the operator surface stays uniform.
// Anchor: rule #9 (pre-registered) + Munafò et al. 2017 — the success
//   thresholds below are committed BEFORE the result is observed (they
//   transcribe the task block's Success line verbatim). The harness
//   evaluates that pre-registration deterministically.
// Conformance: full — the scenario runners are pure (no I/O, no clock);
//   the CLI is the only place the dist `resolveRunAnyModel` is imported.
// Pivot (rule #9): if multi-backend probing proves too costly per
//   iteration in production, the resolver caches probe results (TTL ≥60s)
//   — this harness still passes because it drives the pure decider with
//   fixed fixtures, not live probes.

import process from "node:process";

// ---- Pre-registered thresholds (transcribe the task's Success line) -------

/** Scenario `pin`: fraction of iterations dispatching the pinned model. */
export const PIN_MIN_PINNED_FRACTION = 1.0;
/** Scenario `dynamic`: fraction of budget-banded iterations whose model
 *  tier matches the band (opus@high / sonnet@mid / local@low). */
export const DYNAMIC_MIN_BANDED_CORRECT = 1.0;
/** Scenario `all-down`: max iterations before the switch to local. */
export const ALL_DOWN_MAX_ITERS_TO_SWITCH = 1;
/** Scenario `all-down`: min local-dispatch fraction during the down window. */
export const ALL_DOWN_MIN_LOCAL_FRACTION = 0.95;
/** Scenario `all-down`: max wedged (non-dispatchable) iterations. */
export const ALL_DOWN_MAX_WEDGED = 0;

const REACHABLE_LOCAL = Object.freeze({ reachable: true, observedAtMs: 0 });
const UNREACHABLE_LOCAL = Object.freeze({
  reachable: false,
  observedAtMs: 0,
  reason: "ECONNREFUSED",
});

/** Two remote backends, both unreachable — the `all-down` fixture.
 *  Hoisted to a frozen module const so the down-window loop reuses one
 *  array instead of re-allocating it per iteration (round-trip / GC
 *  elimination on the hot scenario loop). */
const ALL_DOWN_REMOTE_BACKENDS = Object.freeze([
  Object.freeze({ id: "claude", reachable: false, reason: "ENETUNREACH" }),
  Object.freeze({ id: "openrouter", reachable: false, reason: "http 503" }),
]);

/**
 * One scenario's measurement outcome.
 *
 * @typedef {object} AuditResult
 * @property {string} scenario
 * @property {boolean} pass
 * @property {Record<string, number|boolean|string>} metrics
 * @property {Record<string, number>} thresholds
 */

/**
 * Build a `RemainingFractions` with all three windows at `frac`.
 *
 * @param {number} frac
 * @returns {{fivehour:number, weekly:number, monthly:number, observedAt:string}}
 */
function remainingAt(frac) {
  return { fivehour: frac, weekly: frac, monthly: frac, observedAt: "2026-05-17T00:00:00Z" };
}

/**
 * Scenario `pin`: a valid pin must win across every budget × liveness
 * combination. Drives the grid and reports the pinned-dispatch fraction.
 *
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @returns {AuditResult}
 */
export function runPinScenario(resolve) {
  const pin = "claude-sonnet-4-6";
  const budgetBands = [1, 0.6, 0.4, 0.2, 0];
  const livenessStates = [
    [{ id: "claude", reachable: true }],
    [{ id: "claude", reachable: false, reason: "ENETUNREACH" }],
    [
      { id: "claude", reachable: false, reason: "ENETUNREACH" },
      { id: "openrouter", reachable: false, reason: "http 503" },
    ],
  ];
  let total = 0;
  let pinned = 0;
  for (const frac of budgetBands) {
    for (const remoteBackends of livenessStates) {
      const out = resolve({
        remaining: remainingAt(frac),
        remoteBackends,
        localProbeResult: REACHABLE_LOCAL,
        operatorPin: pin,
      });
      total += 1;
      if (out.model === pin && out.source === "operator-pin") pinned += 1;
    }
  }
  const pinnedFraction = total === 0 ? 0 : pinned / total;
  return {
    scenario: "pin",
    pass: pinnedFraction >= PIN_MIN_PINNED_FRACTION,
    metrics: { total, pinned, pinnedFraction },
    thresholds: { minPinnedFraction: PIN_MIN_PINNED_FRACTION },
  };
}

/**
 * Scenario `dynamic`: with no pin and a reachable remote, the model tier
 * must track the remaining-budget band. high≥0.5→opus(claude),
 * mid[0.3,0.5)→sonnet(claude), low<0.3→local.
 *
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @returns {AuditResult}
 */
export function runDynamicScenario(resolve) {
  const cases = [
    { frac: 0.9, wantAgent: "claude", wantModel: "claude-opus-4-7" },
    { frac: 0.5, wantAgent: "claude", wantModel: "claude-opus-4-7" },
    { frac: 0.45, wantAgent: "claude", wantModel: "claude-sonnet-4-6" },
    { frac: 0.3, wantAgent: "claude", wantModel: "claude-sonnet-4-6" },
    { frac: 0.2, wantAgent: "local", wantModel: undefined },
    { frac: 0.0, wantAgent: "local", wantModel: undefined },
  ];
  let total = 0;
  let correct = 0;
  for (const c of cases) {
    const out = resolve({
      remaining: remainingAt(c.frac),
      remoteBackends: [{ id: "claude", reachable: true }],
      localProbeResult: REACHABLE_LOCAL,
    });
    total += 1;
    const agentOk = out.agent === c.wantAgent;
    const modelOk = c.wantModel === undefined ? true : out.model === c.wantModel;
    if (agentOk && modelOk) correct += 1;
  }
  const bandedCorrect = total === 0 ? 0 : correct / total;
  return {
    scenario: "dynamic",
    pass: bandedCorrect >= DYNAMIC_MIN_BANDED_CORRECT,
    metrics: { total, correct, bandedCorrect },
    thresholds: { minBandedCorrect: DYNAMIC_MIN_BANDED_CORRECT },
  };
}

/**
 * Drive `downIters` iterations with every remote backend unreachable
 * (local probe is down on iteration 0 to prove the no-wedge path) and
 * tally: first iteration that switched to local, total local dispatches,
 * and wedged (non-dispatchable) iterations. Extracted from
 * {@link runAllDownScenario} to keep each function under biome's
 * cognitive-complexity cap (≤10).
 *
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @param {number} downIters
 * @returns {{itersToSwitch:number, localDispatches:number, wedged:number}}
 */
function tallyDownWindow(resolve, downIters) {
  /** @type {string[]} */
  const agents = [];
  for (let i = 0; i < downIters; i++) {
    const out = resolve({
      remaining: remainingAt(0.9),
      remoteBackends: ALL_DOWN_REMOTE_BACKENDS,
      localProbeResult: i === 0 ? UNREACHABLE_LOCAL : REACHABLE_LOCAL,
    });
    agents.push(out.agent);
  }
  // Array-derived (no nested branching) so the function stays under
  // biome's cognitive-complexity cap. `findIndex` returns -1 when local
  // was never dispatched — the same sentinel the pass predicate expects.
  return {
    itersToSwitch: agents.findIndex((a) => a === "local"),
    localDispatches: agents.filter((a) => a === "local").length,
    wedged: agents.filter((a) => a !== "local" && a !== "claude").length,
  };
}

/**
 * The `all-down` pass predicate (rule #9 thresholds). Extracted so the
 * scenario runner stays under the cognitive-complexity cap.
 *
 * @param {{itersToSwitch:number, localFraction:number, wedged:number, recoveredToRemote:boolean}} m
 * @returns {boolean}
 */
function allDownPass(m) {
  return (
    m.itersToSwitch >= 0 &&
    m.itersToSwitch <= ALL_DOWN_MAX_ITERS_TO_SWITCH &&
    m.localFraction >= ALL_DOWN_MIN_LOCAL_FRACTION &&
    m.wedged <= ALL_DOWN_MAX_WEDGED &&
    m.recoveredToRemote
  );
}

/**
 * Scenario `all-down`: every remote backend unreachable for K iterations,
 * then a backend recovers. Measures (a) iterations until the switch to
 * local, (b) local-dispatch fraction during the down window, (c) wedged
 * (non-dispatchable) iterations, (d) recovery to the dynamic remote pick.
 *
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @returns {AuditResult}
 */
export function runAllDownScenario(resolve) {
  /** @type {number} */
  const downIters = 20;
  const tally = tallyDownWindow(resolve, downIters);
  const recovered = resolve({
    remaining: remainingAt(0.9),
    remoteBackends: [{ id: "claude", reachable: true }],
    localProbeResult: REACHABLE_LOCAL,
  });
  const { itersToSwitch, localDispatches, wedged } = tally;
  const localFraction = downIters === 0 ? 0 : localDispatches / downIters;
  const recoveredToRemote = recovered.agent === "claude" && recovered.source === "dynamic";
  const pass = allDownPass({ itersToSwitch, localFraction, wedged, recoveredToRemote });
  return {
    scenario: "all-down",
    pass,
    metrics: { downIters, itersToSwitch, localFraction, wedged, recoveredToRemote },
    thresholds: {
      maxItersToSwitch: ALL_DOWN_MAX_ITERS_TO_SWITCH,
      minLocalFraction: ALL_DOWN_MIN_LOCAL_FRACTION,
      maxWedged: ALL_DOWN_MAX_WEDGED,
    },
  };
}

/** Canonical scenario names, in the order `--scenario=all` runs them. */
export const SCENARIO_NAMES = Object.freeze(["pin", "dynamic", "all-down"]);

/**
 * Dispatch one named scenario. Returns `undefined` for an unknown name
 * (the caller renders that as a non-pass error result). A switch — not
 * an object index — so `tsc -b`'s checkJs can prove the lookup total.
 *
 * @param {string} name
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @returns {AuditResult | undefined}
 */
function runScenario(name, resolve) {
  switch (name) {
    case "pin":
      return runPinScenario(resolve);
    case "dynamic":
      return runDynamicScenario(resolve);
    case "all-down":
      return runAllDownScenario(resolve);
    default:
      return undefined;
  }
}

/**
 * Parse `--scenario=<name>` / `--json` from argv. Defaults: scenario
 * `all`, human output.
 *
 * @param {readonly string[]} argv
 * @returns {{scenario:string, json:boolean}}
 */
export function parseArgs(argv) {
  let scenario = "all";
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("--scenario=")) scenario = arg.slice("--scenario=".length);
  }
  return { scenario, json };
}

/**
 * Run one or all scenarios and aggregate. `scenario === "all"` runs the
 * three; otherwise the named one. Unknown name → an error result.
 *
 * @param {(input:any)=>{model:string,agent:string,source:string}} resolve
 * @param {string} scenario
 * @returns {{ok:boolean, results:AuditResult[]}}
 */
export function runAudit(resolve, scenario) {
  const names = scenario === "all" ? [...SCENARIO_NAMES] : [scenario];
  /** @type {AuditResult[]} */
  const results = [];
  for (const name of names) {
    const result = runScenario(name, resolve);
    if (result === undefined) {
      results.push({
        scenario: name,
        pass: false,
        metrics: { error: `unknown scenario: ${name}` },
        thresholds: {},
      });
      continue;
    }
    results.push(result);
  }
  return { ok: results.every((r) => r.pass), results };
}

/**
 * CLI entry. Imports the dist `resolveRunAnyModel` (the typecheck step of
 * `pnpm pre-pr-lint` builds it), runs the requested scenario(s), prints
 * JSON or a human summary, exits 0 on pass / 1 on fail.
 *
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { scenario, json } = parseArgs(argv);
  const mod = await import("@minsky/tick-loop");
  const resolve = mod.resolveRunAnyModel;
  if (typeof resolve !== "function") {
    process.stderr.write(
      "runany-model-audit: @minsky/tick-loop did not export resolveRunAnyModel\n",
    );
    return 1;
  }
  const { ok, results } = runAudit(resolve, scenario);
  process.stdout.write(renderAudit(ok, results, json));
  return ok ? 0 : 1;
}

/**
 * Render the audit outcome as the JSON blob (`--json`) or a one-line-
 * per-scenario human summary. Pure — returns the string the CLI writes.
 * Extracted from {@link main} to keep it under biome's complexity cap.
 *
 * @param {boolean} ok
 * @param {AuditResult[]} results
 * @param {boolean} json
 * @returns {string}
 */
function renderAudit(ok, results, json) {
  if (json) return `${JSON.stringify({ ok, results }, null, 2)}\n`;
  const lines = results.map(
    (r) => `[${r.pass ? "PASS" : "FAIL"}] ${r.scenario}: ${JSON.stringify(r.metrics)}`,
  );
  lines.push(`overall: ${ok ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("runany-model-audit.mjs");
if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
