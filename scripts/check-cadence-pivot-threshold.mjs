#!/usr/bin/env node
// Pattern: deterministic CI gate over a prose-only cadence-pivot
// threshold fraction.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in ARCHITECTURE.md / vision.md /
//   research.md gets a deterministic linter as soon as the artefact it
//   guards becomes machine-readable); research.md L92 ("If measured
//   spend exceeds 8 % for 4 weeks, the pivot in `mape-k-cadence`'s
//   rule-#9 block fires — the cadence design itself is wrong"); Beyer,
//   Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*,
//   O'Reilly 2016, Ch. 3 (error-budget enforcement); Ries, *The Lean
//   Startup*, Crown Business 2011 (pivot-or-persevere — pivot threshold
//   as the falsifiable abandon-the-approach line).
// Conformance: full — pure decision function over `{ config, expected }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: research.md L92 anchors the MAPE-K cadence-
// pivot threshold at 8 % weekly spend ("If measured spend exceeds 8 %
// for 4 weeks, the pivot in `mape-k-cadence`'s rule-#9 block fires").
// The number sits between the 5.7 % budget cap (ARCHITECTURE.md L218 —
// guarded by `check-mape-k-budget-cap`) and the cadence-redesign trigger
// — drift in either direction is load-bearing: lowering it to 6 %
// fires the pivot prematurely; raising it to 12 % defangs the pivot
// trigger entirely. Today the constant is prose-only.
//
// Canonical config file: `config/mape-k.json` per the matching TASKS.md
// brief (`ci-lint-cadence-pivot-threshold`'s "Files" line names this
// artefact). Research.md L92 itself does not name a config file — the
// brief picks `config/mape-k.json` because the threshold is a property
// of the MAPE-K cadence (not of a separate cadence subsystem). This
// matches the colocation of the watchdog-hours / tick-iteration-
// backstop fields shipped by the sibling lints.
//
// Field shape: `cadence_pivot_threshold_pct` (percentage, e.g. 8) OR
// `cadence_pivot_spend_fraction` (fraction, e.g. 0.08). Both shapes
// accepted because the artefact has not landed; whichever the
// implementor picks must equal the prose anchor (8 % == 0.08).
//
// Dormant state (rule #7 — graceful degrade): if `config/mape-k.json`
// is not present, the lint exits 0 with a stderr advisory ("config not
// yet shipped; lint dormant"). Same precedent as
// `check-mape-k-budget-cap`.
//
// Pivot (rule #9, this gate): if the prose anchor itself is moved
// (e.g., 8 % is replaced by a different overshoot envelope in
// research.md), retire this lint and write a new one against the
// replacement anchor.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "mape-k.json");

/**
 * Default expected pivot threshold (percent). Anchored to research.md
 * L92 ("exceeds 8 % for 4 weeks"). Locked by a paired test so a silent
 * edit surfaces loudly.
 */
export const DEFAULT_EXPECTED_PCT = 8;

/**
 * @typedef {{
 *   cadence_pivot_threshold_pct?: unknown,
 *   cadence_pivot_spend_fraction?: unknown
 * }} MapeKConfig
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
 */

const EPSILON = 1e-9;

/**
 * Pure function. Asserts the mape-k config's cadence-pivot threshold
 * equals the prose-anchored 8 % (== 0.08). Accepts both percent (e.g.,
 * 8) and fraction (e.g., 0.08) shapes.
 *
 * @param {{ config: MapeKConfig | null, expectedPct?: number }} args
 * @returns {CheckResult}
 */
export function checkCadencePivotThreshold({ config, expectedPct }) {
  const wantPct = expectedPct ?? DEFAULT_EXPECTED_PCT;
  if (config === null || config === undefined) {
    return {
      ok: false,
      reason:
        "config is null; the dormant-config short-circuit lives in the CLI, not the pure function.",
    };
  }
  const actualPct = resolvePct(config);
  if (actualPct === null) {
    return {
      ok: false,
      reason:
        "config has neither a `cadence_pivot_threshold_pct` (percent) nor a `cadence_pivot_spend_fraction` (fraction) finite positive number field.",
    };
  }
  if (Math.abs(actualPct - wantPct) > EPSILON) {
    return {
      ok: false,
      reason: `cadence-pivot-threshold drift: config has ${actualPct} %, expected ${wantPct} % (research.md L92: "exceeds 8 % for 4 weeks"). Fix config or update the prose anchor.`,
    };
  }
  return { ok: true };
}

/**
 * Returns the pivot threshold in *percent* units, normalising the two
 * accepted shapes. Returns `null` for malformed inputs.
 *
 * @param {MapeKConfig} config
 * @returns {number | null}
 */
function resolvePct(config) {
  if (typeof config.cadence_pivot_threshold_pct === "number") {
    const v = config.cadence_pivot_threshold_pct;
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }
  if (typeof config.cadence_pivot_spend_fraction === "number") {
    const f = config.cadence_pivot_spend_fraction;
    if (!Number.isFinite(f) || f <= 0 || f >= 1) return null;
    return f * 100;
  }
  return null;
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
      `cadence-pivot-threshold: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (config === null) {
    process.stderr.write(
      `cadence-pivot-threshold advisory: ${path} not present; lint dormant until the mape-k-loop config artefact ships (rule #7 graceful degrade).\n`,
    );
    return 0;
  }

  const result = checkCadencePivotThreshold({ config });
  if (!result.ok) {
    process.stderr.write(`cadence-pivot-threshold violation:\n  - ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(
    "cadence-pivot-threshold ok: cadence_pivot_threshold matches the 8 % prose anchor (research.md L92).\n",
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-cadence-pivot-threshold.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
