#!/usr/bin/env node
// Pattern: deterministic CI gate over a prose-only watchdog cadence
// integer (hours).
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in ARCHITECTURE.md / vision.md /
//   research.md gets a deterministic linter as soon as the artefact it
//   guards becomes machine-readable); ARCHITECTURE.md L218 ("cron fires
//   the time-based watchdog every 12 h regardless"); Liu, *Real-Time
//   Systems*, Prentice Hall 2000 (sampling-period selection); Beyer,
//   Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*,
//   O'Reilly 2016, Ch. 3 (error-budget enforcement).
// Conformance: full — pure decision function over `{ config, expected }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: ARCHITECTURE.md L218 anchors the MAPE-K time-
// based watchdog cadence at 12 h. research.md § "MAPE-K cadence"
// derives the 5.7 % weekly-spend estimate from this number (14 watchdog
// passes/week × ≤0.3 % per pass). A drift to 6 h would double the
// watchdog spend to ~8.4 %, breaching the cadence-pivot threshold.
// Today the constant is prose-only. Once the future `config/mape-k.json`
// artifact lands, this linter reads its `watchdog_hours` (or
// `watchdog_period_hours` — both shapes accepted) field and asserts it
// equals 12 mechanically on every PR.
//
// Dormant state (rule #7 — graceful degrade): if `config/mape-k.json`
// is not present, the lint exits 0 with a stderr advisory ("config not
// yet shipped; lint dormant"). Same precedent as
// `check-mape-k-budget-cap`.
//
// Pivot (rule #9, this gate): if the 12 h watchdog is replaced by
// exponential / adaptive cadence after `mape-k-loop`'s monthly self-
// calibration extends T to 18 h per ARCHITECTURE L218, retire this lint
// and write a new one against the replacement anchor (or against the
// calibrated value in the `mape-k-loop` Knowledge log).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "mape-k.json");

/**
 * Default expected watchdog cadence (hours). Anchored to
 * ARCHITECTURE.md L218 ("every 12 h regardless"). Locked by a paired
 * test so a silent edit surfaces loudly.
 */
export const DEFAULT_EXPECTED_HOURS = 12;

/**
 * @typedef {{
 *   watchdog_hours?: unknown,
 *   watchdog_period_hours?: unknown
 * }} MapeKConfig
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
 */

/**
 * Pure function. Asserts the mape-k config's watchdog cadence equals
 * the prose-anchored 12 hours.
 *
 * @param {{ config: MapeKConfig | null, expected?: number }} args
 * @returns {CheckResult}
 */
export function checkMapeKWatchdogCadence({ config, expected }) {
  const want = expected ?? DEFAULT_EXPECTED_HOURS;
  if (config === null || config === undefined) {
    return {
      ok: false,
      reason:
        "config is null; the dormant-config short-circuit lives in the CLI, not the pure function.",
    };
  }
  const actual = resolveHours(config);
  if (actual === null) {
    return {
      ok: false,
      reason:
        "config has neither a `watchdog_hours` nor a `watchdog_period_hours` finite positive number field.",
    };
  }
  if (actual !== want) {
    return {
      ok: false,
      reason: `mape-k watchdog-cadence drift: config has ${actual} h, expected ${want} h (ARCHITECTURE.md L218: "every 12 h regardless"). Fix config or update the prose anchor.`,
    };
  }
  return { ok: true };
}

/**
 * @param {MapeKConfig} config
 * @returns {number | null}
 */
function resolveHours(config) {
  const candidate =
    config.watchdog_hours !== undefined ? config.watchdog_hours : config.watchdog_period_hours;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    return null;
  }
  return candidate;
}

/**
 * Read + parse `config/mape-k.json`. Returns `null` on ENOENT (dormant
 * state). Throws on malformed JSON / non-object.
 *
 * @param {string} path
 * @returns {MapeKConfig | null}
 */
export function readMapeKConfig(path) {
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return null;
    throw err;
  }
  /** @type {unknown} */
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`mape-k config at ${path} must be a JSON object`);
  }
  return /** @type {MapeKConfig} */ (parsed);
}

/**
 * CLI: reads `config/mape-k.json` (or path arg) and runs the check.
 *
 * Exit codes:
 *   0 — pass, OR config missing (dormant)
 *   1 — fail (drift)
 *   2 — I/O error or malformed config
 *
 * @returns {Promise<number>}
 */
async function main() {
  const path = process.argv[2] ?? DEFAULT_CONFIG_PATH;
  /** @type {MapeKConfig | null} */
  let config;
  try {
    config = readMapeKConfig(path);
  } catch (err) {
    process.stderr.write(
      `mape-k-watchdog-cadence: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (config === null) {
    process.stderr.write(
      `mape-k-watchdog-cadence advisory: ${path} not present; lint dormant until the mape-k-loop config artefact ships (rule #7 graceful degrade).\n`,
    );
    return 0;
  }

  const result = checkMapeKWatchdogCadence({ config });
  if (!result.ok) {
    process.stderr.write(`mape-k-watchdog-cadence violation:\n  - ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(
    "mape-k-watchdog-cadence ok: watchdog_hours matches the 12 h prose anchor (ARCHITECTURE.md L218).\n",
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-mape-k-watchdog-cadence.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
