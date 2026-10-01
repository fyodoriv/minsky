#!/usr/bin/env node
// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 2 (operator 2026-05-16 directive — pre-registered measurement harness for the unified pin>dynamic>local decider) -->
// Pattern: pure transforms (`runScenario`, `tierOf`, `summarize`) composed
//   with one injected decider seam (`decideRunAnyProvider`, defaulted to the
//   shipped slice-1 pure function) above a thin `--scenario/--json` CLI —
//   same shape as `cto-audit-metrics.mjs` so the operator surface stays
//   uniform. Rule #8 pure-decision-delegate + Strategy-seam conformance:
//   full (the decider is injected; the CLI is the only I/O boundary).
// Source: TASKS.md `runany-dynamic-model-or-local-fallback` Measurement line
//   — `node scripts/runany-model-audit.mjs --scenario=<pin|dynamic|all-down>
//   --json` is the exact pre-registered command that evaluates the task's
//   3-clause Success threshold. Munafò et al. 2017 (pre-registration): the
//   thresholds below are committed BEFORE the result is observed; this
//   script evaluates that pre-registration deterministically (rule #10) so a
//   regression in the decider becomes an exit-1 gate break, not a silent
//   mis-degrade. Composes the shipped slice-1 `decideRunAnyProvider`
//   (rule #1 — compose, don't reinvent the decision table here).
// Conformance: full — `runScenario`/`tierOf`/`summarize` are referentially
//   transparent over their inputs; `main` is the only place that reads argv
//   and writes stdout / sets the exit code.
// Pivot (rule #9): if the 3 fixed scenarios prove too coarse to localise a
//   regression, add `--iterations=N` and a per-band breakdown — do NOT
//   retire the script or weaken a threshold. The thresholds are
//   pre-registered and not tunable from the CLI.

import process from "node:process";

import { MODEL_CATALOG } from "./lib/model-catalog.mjs";
import { decideRunAnyProvider } from "./lib/runany-provider-decision.mjs";

/**
 * One provider decision. Deliberately loose on `kind`/`agent` (typed as
 * `string`) so a mutant decider in the negative fixtures can return an
 * out-of-contract value and `isWedged` can catch it at runtime.
 *
 * @typedef {{model: string, agent: string, kind: string, reason: string}} Decision
 */

/**
 * The injected decider seam — the real shipped `decideRunAnyProvider`, or
 * a mutant in the negative fixtures. The input is the structural
 * `RunAnyProviderInput`; typed `any` here so the harness stays decoupled
 * from the tick-loop input type (and a no-arg mutant decider is still
 * assignable).
 *
 * @typedef {(input: any) => Decision} Decider
 */

/**
 * Catalog row subset this harness reads (id → qualityTier). The real
 * `MODEL_CATALOG` rows carry more fields; only these two are consumed.
 *
 * @typedef {{ readonly id: string, readonly qualityTier: number }} CatalogRow
 */

/**
 * Union of every metric any scenario emits. All optional so one
 * `ScenarioResult` type covers all three scenarios (the relevant subset
 * is populated per scenario).
 *
 * @typedef {Object} ScenarioMetrics
 * @property {number} [pinnedRate]
 * @property {number} [wedged]
 * @property {number} [total]
 * @property {number[]} [tiers]
 * @property {boolean} [monotone]
 * @property {boolean} [topIsTier1]
 * @property {boolean} [bottomIsLocal]
 * @property {number} [switchIters]
 * @property {number} [localRate]
 * @property {number} [faultIterations]
 */

/**
 * Verdict for one scenario.
 *
 * @typedef {Object} ScenarioResult
 * @property {string} scenario
 * @property {boolean} ok
 * @property {ScenarioMetrics} metrics
 * @property {Object} thresholds
 * @property {object[]} iterations
 */

/** The three pre-registered scenarios (TASKS.md Measurement `--scenario=`). */
export const SCENARIOS = Object.freeze(["pin", "dynamic", "all-down"]);

/** Pin scenario success: pinned-model dispatch fraction must equal 1.0
 *  (TASKS.md Success — "(pin) 100% pinned-model dispatch"). */
export const PIN_DISPATCH_MIN = 1.0;

/** all-down scenario: ≥95% local dispatch after the switch
 *  (TASKS.md Success — "then ≥95% local dispatch"). */
export const ALLDOWN_LOCAL_MIN = 0.95;

/** all-down scenario: ≤1 iteration to switch fully to local
 *  (TASKS.md Success / Acceptance 3 — "≤1 iteration to switch to local"). */
export const ALLDOWN_MAX_SWITCH_ITERS = 1;

/** Any scenario: 0 wedged/halted iterations — `local` is the always-
 *  available last resort, the decider must never return a hold state
 *  (TASKS.md Success — "0 wedged/halted iterations"). */
export const WEDGED_MAX = 0;

/** The only decision kinds the slice-1 decider may emit. Anything else
 *  (or a missing model/agent) counts as a wedged iteration. */
const VALID_KINDS = Object.freeze(["operator-pin", "dynamic", "local-fallback"]);

/** A pinned model from the catalog used for the `pin` scenario. */
const PIN_MODEL = "claude-sonnet-4-6";

/**
 * Descending remaining-budget sweep for the `dynamic` scenario. Each band
 * is strictly lower than the previous across all three windows, so the
 * selected `qualityTier` must be monotone NON-DECREASING (quality may only
 * degrade as budget drops — never improve). The exact tier per band is
 * intentionally NOT asserted here so the audit stays robust to catalog
 * floor refreshes (model-catalog.ts carries a quarterly `recordedAt`); the
 * contract under test is the correlation, plus tier-1 at the top band and
 * an `agent:"local"` row at the bottom band.
 */
const DYNAMIC_SWEEP = Object.freeze([
  { fivehour: 1.0, weekly: 1.0, monthly: 1.0 },
  { fivehour: 0.6, weekly: 0.4, monthly: 0.3 },
  { fivehour: 0.35, weekly: 0.25, monthly: 0.16 },
  { fivehour: 0.05, weekly: 0.05, monthly: 0.05 },
]);

/**
 * Resolve a model id to its catalog `qualityTier`. Unknown ids (e.g. a
 * synthetic `local` fallback when a custom catalog has no local row) map
 * to `Infinity` so they sort as the lowest possible quality.
 *
 * @param {string} model
 * @param {readonly CatalogRow[]} [catalog]
 * @returns {number}
 */
export function tierOf(model, catalog = MODEL_CATALOG) {
  const row = catalog.find((e) => e.id === model);
  return row === undefined ? Number.POSITIVE_INFINITY : row.qualityTier;
}

/**
 * Build a `RemainingFractions` from a window triple.
 *
 * @param {{fivehour:number, weekly:number, monthly:number}} w
 * @returns {{fivehour:number, weekly:number, monthly:number, observedAt:string}}
 */
function mkRemaining(w) {
  return { ...w, observedAt: "2026-05-16T00:00:00Z" };
}

/**
 * `true` when a decision is wedged: an unknown `kind`, or a missing
 * model/agent. The decider's contract is that `local` is always reachable,
 * so a wedged iteration is a hard failure of Acceptance 3.
 *
 * @param {Decision | null | undefined} d
 * @returns {boolean}
 */
function isWedged(d) {
  return (
    d === null ||
    d === undefined ||
    !VALID_KINDS.includes(d.kind) ||
    typeof d.model !== "string" ||
    d.model.length === 0 ||
    (d.agent !== "claude" && d.agent !== "local")
  );
}

/**
 * Run one pre-registered scenario through the injected decider and return
 * its metrics + pass/fail verdict against the pre-registered thresholds.
 * Pure: no I/O, deterministic over `(scenario, decide, catalog)`.
 *
 * @param {string} scenario one of {@link SCENARIOS}
 * @param {{decide?: Decider, catalog?: readonly CatalogRow[]}} [deps]
 *   `catalog` is consumed only by the `dynamic` scenario (tier
 *   resolution); the `pin`/`all-down` scenarios assert agent/kind.
 * @returns {ScenarioResult}
 */
export function runScenario(scenario, deps = {}) {
  const decide = deps.decide ?? decideRunAnyProvider;
  const catalog = deps.catalog ?? MODEL_CATALOG;
  if (scenario === "pin") return runPinScenario(decide);
  if (scenario === "dynamic") return runDynamicScenario(decide, catalog);
  if (scenario === "all-down") return runAllDownScenario(decide);
  throw new Error(`unknown scenario "${scenario}" — expected one of ${SCENARIOS.join("|")}`);
}

/**
 * `pin` — operator pin honored verbatim in 100% of iterations regardless
 * of budget band or backend liveness (TASKS.md Success clause 1).
 *
 * @param {Decider} decide
 * @returns {ScenarioResult}
 */
function runPinScenario(decide) {
  /** @type {{input: object, decision: Decision}[]} */
  const iterations = [];
  for (const w of DYNAMIC_SWEEP) {
    for (const reachable of [true, false]) {
      const d = decide({
        remaining: mkRemaining(w),
        remoteBackends: [{ id: "claude", reachable }],
        operatorPin: PIN_MODEL,
      });
      iterations.push({ input: { remaining: w, reachable }, decision: d });
    }
  }
  const pinned = iterations.filter(
    (it) => it.decision.kind === "operator-pin" && it.decision.model === PIN_MODEL,
  ).length;
  const pinnedRate = iterations.length === 0 ? 0 : pinned / iterations.length;
  const wedged = iterations.filter((it) => isWedged(it.decision)).length;
  const ok = pinnedRate >= PIN_DISPATCH_MIN && wedged <= WEDGED_MAX;
  return {
    scenario: "pin",
    ok,
    metrics: { pinnedRate, wedged, total: iterations.length },
    thresholds: { pinnedRate: PIN_DISPATCH_MIN, wedged: WEDGED_MAX },
    iterations,
  };
}

/**
 * `dynamic` — no pin, ≥1 remote reachable: the selected `qualityTier`
 * tracks the remaining-budget bands (monotone non-decreasing as budget
 * descends; tier-1 at the top band; an `agent:"local"` row at the bottom
 * band). TASKS.md Success clause 2.
 *
 * @param {Decider} decide
 * @param {readonly CatalogRow[]} catalog
 * @returns {ScenarioResult}
 */
function runDynamicScenario(decide, catalog) {
  const iterations = DYNAMIC_SWEEP.map((w) => {
    const d = decide({
      remaining: mkRemaining(w),
      remoteBackends: [{ id: "claude", reachable: true }],
    });
    return { input: { remaining: w }, decision: d, tier: tierOf(d.model, catalog) };
  });
  const tiers = iterations.map((it) => it.tier);
  let monotone = true;
  for (let i = 1; i < tiers.length; i++) {
    const cur = tiers[i];
    const prev = tiers[i - 1];
    if (cur !== undefined && prev !== undefined && cur < prev) monotone = false;
  }
  const topIsTier1 = tiers[0] === 1;
  const bottomIsLocal = iterations[iterations.length - 1]?.decision.agent === "local";
  const wedged = iterations.filter((it) => isWedged(it.decision)).length;
  const ok = monotone && topIsTier1 && bottomIsLocal && wedged <= WEDGED_MAX;
  return {
    scenario: "dynamic",
    ok,
    metrics: { tiers, monotone, topIsTier1, bottomIsLocal, wedged },
    thresholds: { monotone: true, topIsTier1: true, bottomIsLocal: true, wedged: WEDGED_MAX },
    iterations,
  };
}

/**
 * `all-down` — no pin, every remote backend down: switch fully to local
 * within ≤1 iteration, then ≥95% local dispatch, 0 wedged iterations.
 * Iteration 0 is the last-good remote-up tick; iterations 1..N are the
 * all-down regime. The "switch iteration" is the first all-down tick that
 * returns `agent:"local"`. TASKS.md Success clause 3 / Acceptance 3.
 *
 * @param {Decider} decide
 * @returns {ScenarioResult}
 */
function runAllDownScenario(decide) {
  const ALL_DOWN = [
    { id: "claude", reachable: false, reason: "econnrefused" },
    { id: "bedrock", reachable: false, reason: "timeout" },
  ];
  const N = 20;
  /** @type {{iter: number, remoteUp: boolean, decision: Decision}[]} */
  const iterations = [];
  for (let i = 0; i < N; i++) {
    const remoteUp = i === 0;
    const d = decide({
      remaining: mkRemaining({ fivehour: 1, weekly: 1, monthly: 1 }),
      remoteBackends: remoteUp ? [{ id: "claude", reachable: true }] : ALL_DOWN,
    });
    iterations.push({ iter: i, remoteUp, decision: d });
  }
  const afterFault = iterations.filter((it) => !it.remoteUp);
  const firstLocalIdx = afterFault.findIndex((it) => it.decision.agent === "local");
  // iterations to switch = index within the all-down regime of the first
  // local dispatch (0 = switched on the very first all-down tick).
  const switchIters = firstLocalIdx < 0 ? Number.POSITIVE_INFINITY : firstLocalIdx;
  const localCount = afterFault.filter((it) => it.decision.agent === "local").length;
  const localRate = afterFault.length === 0 ? 0 : localCount / afterFault.length;
  const wedged = iterations.filter((it) => isWedged(it.decision)).length;
  const ok =
    switchIters <= ALLDOWN_MAX_SWITCH_ITERS &&
    localRate >= ALLDOWN_LOCAL_MIN &&
    wedged <= WEDGED_MAX;
  return {
    scenario: "all-down",
    ok,
    metrics: { switchIters, localRate, wedged, faultIterations: afterFault.length },
    thresholds: {
      switchIters: ALLDOWN_MAX_SWITCH_ITERS,
      localRate: ALLDOWN_LOCAL_MIN,
      wedged: WEDGED_MAX,
    },
    iterations,
  };
}

/**
 * Human-readable one-block summary of a scenario result.
 *
 * @param {ScenarioResult} r
 * @returns {string}
 */
export function summarize(r) {
  const verdict = r.ok ? "PASS" : "FAIL";
  const m = JSON.stringify(r.metrics);
  const t = JSON.stringify(r.thresholds);
  return `[runany-model-audit] scenario=${r.scenario} ${verdict}\n  metrics=${m}\n  thresholds=${t}\n`;
}

/**
 * Parse `--scenario=` and `--json` from argv. `--scenario=all` (or no
 * scenario) runs all three. Pure over the arg array.
 *
 * @param {string[]} argv
 * @returns {{scenarios: string[], json: boolean}}
 */
export function parseArgs(argv) {
  const json = argv.includes("--json");
  const sArg = argv.find((a) => a.startsWith("--scenario="));
  const raw = sArg === undefined ? "all" : sArg.slice("--scenario=".length);
  if (raw === "all") return { scenarios: [...SCENARIOS], json };
  if (!SCENARIOS.includes(raw)) {
    throw new Error(`unknown --scenario=${raw} — expected one of ${SCENARIOS.join("|")}|all`);
  }
  return { scenarios: [raw], json };
}

/**
 * CLI entry — the only I/O boundary. Reads argv, runs the requested
 * scenarios, writes JSON or a human summary, returns the exit code.
 *
 * @returns {Promise<number>}
 */
async function main() {
  const { scenarios, json } = parseArgs(process.argv.slice(2));
  const results = scenarios.map((s) => runScenario(s));
  if (json) {
    process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results)}\n`);
  } else {
    for (const r of results) process.stdout.write(summarize(r));
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("runany-model-audit.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
