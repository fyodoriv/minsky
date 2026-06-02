#!/usr/bin/env node
// <!-- scope: human-approved operator-machine-budget-autoscale slice 2 — rule-#10 deterministic gate (operator directive 2026-05-17) -->
// Pattern: deterministic CI gate over the operator's machine-utilisation
// budget contract (rule #10 — every prose-only invariant in vision.md /
// the task block gets a deterministic linter as soon as the artefact it
// guards becomes machine-readable).
//
// Source: vision.md rule #15 ("match the operator's machine-utilisation
//   budget — no more, no less"); operator directive 2026-05-17 (verbatim
//   in the `operator-machine-budget-autoscale` TASKS.md block); Apple
//   `launchd.plist(5)` (`ProcessType` QoS — `Background` makes macOS
//   throttle CPU/IO so the budget is physically unreachable); Saltzer &
//   Schroeder 1975 (fail-safe defaults — a missing controller is dormant,
//   not a green pass that hides a regression).
// Conformance: full — pure decision function over
//   `{ controllerSource, controllerTestSource, plists }`, thin CLI
//   wrapper owns all I/O, no LLM in the chain.
//
// Why this gate exists: the task block's part (e) requires a rule-#10
// check that, on every PR, asserts three machine-budget invariants that
// are otherwise prose-only and regressed silently once (the worker plist
// empirically shipped `ProcessType=Background`, making the operator's
// budget unreachable; a fixed `--spawn-additional-workers` constant
// could not track the saturation knee):
//
//   1. **Budget contract present** — `machine-budget-autoscaler.ts`
//      still exports `resolveMachineBudgetPct` + `computeWorkerTarget`
//      and pins `defaultBudgetPct: 70` / `swarmMaxBudgetPct: 80`. If a
//      refactor drops or renames the resolver, the budget stops being
//      parsed and the autoscaler silently free-runs.
//   2. **No contradicting OS throttle** — no repo-tracked launchd
//      template for a minsky tick-loop / worker sets
//      `ProcessType=Background`. With any non-trivial budget (the
//      default 70 is non-trivial) `Background` is a hard fail: the QoS
//      class throttles the very CPU/IO the budget allocates.
//   3. **Pre-registered controller tests** — the controller test file
//      keeps the three rule-#9 pre-registered behaviour suites
//      (ramp-up, knee detection, gridlock backoff). Deleting a suite
//      would let the controller logic drift unobserved.
//
// Dormant state (rule #7 — graceful degrade): if the controller file is
// not present (slice 1 not yet landed on this branch), the lint exits 0
// with a stderr advisory. The deterministic check activates the moment
// the controller artefact lands — same precedent as
// `check-mape-k-budget-cap`'s dormant-config state.
//
// Pivot (rule #9, this gate): if `ProcessType` stops being the throttle
// that makes the budget unreachable (e.g. macOS removes the QoS clamp,
// or minsky moves workers off launchd entirely), retire check #2 and
// replace it with one over whatever the new throttle surface is — never
// weaken it to a warning.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CONTROLLER_PATH = resolve(
  REPO_ROOT,
  "novel",
  "tick-loop",
  "src",
  "machine-budget-autoscaler.ts",
);
const CONTROLLER_TEST_PATH = resolve(
  REPO_ROOT,
  "novel",
  "tick-loop",
  "src",
  "machine-budget-autoscaler.test.ts",
);
const LAUNCHD_DIR = resolve(REPO_ROOT, "distribution", "launchd");

/**
 * Budget percentages at or below this are "trivial" — a near-zero
 * budget that intentionally idles the box, where a `Background` QoS is
 * not a contradiction. The operator default (70) is far above this, so
 * in practice any `Background` on a minsky worker/tick-loop plist fails.
 * Anchored to vision.md rule #15 (the budget is the contract; only a
 * deliberately tiny budget tolerates a throttle).
 */
export const TRIVIAL_BUDGET_PCT = 10;

/**
 * @typedef {{ path: string, text: string }} PlistFile
 * @typedef {{ ok: true } | { ok: false, reasons: string[] }} CheckResult
 */

/**
 * Extract a launchd `ProcessType` value from plist XML, or `null` when
 * the key is absent (absence is fine — launchd defaults to a non-
 * throttled `Standard`-equivalent for `RunAtLoad` agents).
 *
 * @param {string} text
 * @returns {string | null}
 */
function extractProcessType(text) {
  const m = text.match(/<key>\s*ProcessType\s*<\/key>\s*<string>\s*([^<]*?)\s*<\/string>/i);
  return m?.[1] ?? null;
}

/**
 * Does this plist govern a minsky tick-loop / worker process? The
 * `Background` QoS only contradicts the budget for the processes the
 * budget is *about* — a one-off helper agent may legitimately be
 * `Background`. Matches on the minsky tick-loop / worker / opus-sonnet
 * run signatures that appear in the Label or ProgramArguments.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isMinskyWorkerPlist(text) {
  return /tick-loop|opus-sonnet-run|minsky.*worker|spawn-additional-workers/i.test(text);
}

/**
 * Sub-check (1): the budget contract is present and the documented
 * policy constants are pinned. Returns the parsed default-budget
 * percent (used by sub-check 2) plus any contract-violation reasons.
 *
 * @param {string} controllerSource
 * @returns {{ reasons: string[], configuredDefault: number }}
 */
function checkBudgetContract(controllerSource) {
  /** @type {string[]} */
  const reasons = [];
  if (!/export function resolveMachineBudgetPct\b/.test(controllerSource)) {
    reasons.push(
      "machine-budget-autoscaler.ts no longer exports `resolveMachineBudgetPct` — the operator budget would stop being parsed (task part (a)).",
    );
  }
  if (!/export function computeWorkerTarget\b/.test(controllerSource)) {
    reasons.push(
      "machine-budget-autoscaler.ts no longer exports `computeWorkerTarget` — the autoscaler controller is gone (task part (b)).",
    );
  }
  const defaultBudget = controllerSource.match(/defaultBudgetPct:\s*(\d+)/);
  if (!defaultBudget || Number(defaultBudget[1]) !== 70) {
    reasons.push(
      `MACHINE_BUDGET_POLICY.defaultBudgetPct must be pinned to 70 (vision.md rule #15 default); found ${defaultBudget ? defaultBudget[1] : "no pin"}.`,
    );
  }
  if (!/swarmMaxBudgetPct:\s*80\b/.test(controllerSource)) {
    reasons.push(
      "MACHINE_BUDGET_POLICY.swarmMaxBudgetPct must be pinned to 80 (operator directive 2026-05-17 swarm ceiling).",
    );
  }
  return { reasons, configuredDefault: defaultBudget ? Number(defaultBudget[1]) : 70 };
}

/**
 * Sub-check (2): no minsky worker/tick-loop launchd template sets
 * `ProcessType=Background` while the configured budget is non-trivial
 * (the QoS class throttles the very CPU/IO the budget allocates).
 *
 * @param {PlistFile[]} plists
 * @param {number} configuredDefault
 * @returns {string[]}
 */
function checkNoContradictingThrottle(plists, configuredDefault) {
  if (configuredDefault <= TRIVIAL_BUDGET_PCT) return [];
  /** @type {string[]} */
  const reasons = [];
  for (const plist of plists) {
    if (!isMinskyWorkerPlist(plist.text)) continue;
    if (extractProcessType(plist.text) === "Background") {
      reasons.push(
        `${plist.path} sets <ProcessType>Background</ProcessType> on a minsky worker/tick-loop agent while the configured budget (${configuredDefault}%) is non-trivial. macOS throttles CPU/IO for Background QoS, making the operator's machine budget physically unreachable (launchd.plist(5); operator directive 2026-05-17 — empirically the budget gridlocked). Set ProcessType=Standard and mirror the host change as the ~/apps/dotfiles task (task part (c)/(d)).`,
      );
    }
  }
  return reasons;
}

/**
 * Sub-check (3): the controller test file keeps the three rule-#9
 * pre-registered behaviour suites.
 *
 * @param {string} controllerTestSource
 * @returns {string[]}
 */
function checkPreRegisteredSuites(controllerTestSource) {
  const PRE_REGISTERED = [
    { label: "ramp-up", pattern: /ramp-?up/i },
    { label: "knee detection", pattern: /knee/i },
    { label: "gridlock backoff", pattern: /gridlock/i },
  ];
  return PRE_REGISTERED.filter((s) => !s.pattern.test(controllerTestSource)).map(
    (s) =>
      `machine-budget-autoscaler.test.ts is missing the pre-registered "${s.label}" behaviour suite — rule #9 requires each scaling behaviour to keep a paired test (task part (b)/(e)).`,
  );
}

/**
 * Pure function. Decides whether the machine-budget contract holds by
 * composing the three sub-checks. `controllerSource` /
 * `controllerTestSource` of `null` is a programmer error here — the
 * dormant short-circuit lives in the CLI, not the pure function (same
 * split as `check-mape-k-budget-cap`).
 *
 * @param {{
 *   controllerSource: string | null,
 *   controllerTestSource: string | null,
 *   plists: PlistFile[],
 * }} args
 * @returns {CheckResult}
 */
export function checkMachineBudget({ controllerSource, controllerTestSource, plists }) {
  if (controllerSource === null || controllerTestSource === null) {
    return {
      ok: false,
      reasons: [
        "controllerSource/controllerTestSource is null; the dormant short-circuit lives in the CLI, not the pure function.",
      ],
    };
  }
  const contract = checkBudgetContract(controllerSource);
  const reasons = [
    ...contract.reasons,
    ...checkNoContradictingThrottle(plists, contract.configuredDefault),
    ...checkPreRegisteredSuites(controllerTestSource),
  ];
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * Read a UTF-8 file, returning `null` on ENOENT (the dormant signal) and
 * re-throwing every other error (rule-#6 let-it-crash with a precise
 * error).
 *
 * @param {string} path
 * @returns {string | null}
 */
export function readOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Enumerate repo-tracked launchd plist templates under
 * `distribution/launchd/`. Returns `[]` when the directory is absent.
 *
 * @param {string} dir
 * @returns {PlistFile[]}
 */
export function readLaunchdPlists(dir) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return [];
    throw err;
  }
  /** @type {PlistFile[]} */
  const plists = [];
  for (const name of entries) {
    if (!name.endsWith(".plist")) continue;
    const path = join(dir, name);
    plists.push({ path, text: readFileSync(path, "utf8") });
  }
  return plists;
}

/**
 * CLI: reads the controller, its test, and the launchd templates, then
 * runs `checkMachineBudget`.
 *
 * Exit codes:
 *   0 — pass, OR controller missing (dormant state)
 *   1 — fail (a budget invariant is broken)
 *   2 — I/O error (rule-#6 let-it-crash)
 *
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {string | null} */
  let controllerSource;
  /** @type {string | null} */
  let controllerTestSource;
  /** @type {PlistFile[]} */
  let plists;
  try {
    controllerSource = readOrNull(CONTROLLER_PATH);
    controllerTestSource = readOrNull(CONTROLLER_TEST_PATH);
    plists = readLaunchdPlists(LAUNCHD_DIR);
  } catch (err) {
    process.stderr.write(
      `machine-budget: I/O error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (controllerSource === null || controllerTestSource === null) {
    process.stderr.write(
      "machine-budget advisory: machine-budget-autoscaler.ts not present; lint dormant until the controller artefact lands (rule #7 graceful degrade).\n",
    );
    return 0;
  }

  const result = checkMachineBudget({
    controllerSource,
    controllerTestSource,
    plists,
  });
  if (!result.ok) {
    process.stderr.write(
      `machine-budget violation(s):\n${result.reasons.map((r) => `  - ${r}`).join("\n")}\n`,
    );
    return 1;
  }
  process.stdout.write(
    "machine-budget ok: budget contract pinned, no contradicting ProcessType=Background throttle, controller behaviour suites present.\n",
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-machine-budget.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
