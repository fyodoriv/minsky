#!/usr/bin/env node
// Pattern: deterministic CI gate over a prose-only tick-iteration
// backstop integer.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in ARCHITECTURE.md / vision.md /
//   research.md gets a deterministic linter as soon as the artefact it
//   guards becomes machine-readable); ARCHITECTURE.md L218 ("a tick-
//   iteration backstop forces a pass every 1000 ticks"); Liu, *Real-Time
//   Systems*, Prentice Hall 2000, § 6.4 (activity-coupled sampling
//   bound); Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability
//   Engineering*, O'Reilly 2016, Ch. 3 (error-budget enforcement).
// Conformance: full — pure decision function over `{ config, expected }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: ARCHITECTURE.md L218 anchors the MAPE-K cadence's
// tick-iteration backstop at 1000 ticks. Today the constant is prose-
// only. Once the future `config/mape-k.json` artifact lands, drift
// between ARCHITECTURE.md and the runtime config (e.g., 500 — twice as
// many backstop passes per quarter, doubling the projected cost
// component) would silently breach the 5.7 % budget cap without any CI
// signal until `check-mape-k-budget-cap` itself fires. This linter
// reads `config/mape-k.json` and asserts its `tick_iteration_backstop`
// (or `tick_iteration_backstop_ticks` — both shapes accepted) field
// equals 1000 mechanically on every PR.
//
// Dormant state (rule #7 — graceful degrade): if `config/mape-k.json`
// is not present, the lint exits 0 with a stderr advisory ("config not
// yet shipped; lint dormant"). Same precedent as
// `check-mape-k-budget-cap`.
//
// Pivot (rule #9, this gate): if the 1000-tick floor is replaced by an
// activity-coupled formula instead of a fixed integer (per Liu 2000
// § 6.4 — "non-uniform sampling, activity-coupled bound"), retire this
// lint and write a new one against the replacement anchor.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "mape-k.json");

/**
 * Default expected backstop. Anchored to ARCHITECTURE.md L218 ("a tick-
 * iteration backstop forces a pass every 1000 ticks"). Locked by a
 * paired test so a silent edit surfaces loudly.
 */
export const DEFAULT_EXPECTED_BACKSTOP = 1000;

/**
 * @typedef {{
 *   tick_iteration_backstop?: unknown,
 *   tick_iteration_backstop_ticks?: unknown
 * }} MapeKConfig
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
 */

/**
 * Pure function. Asserts the mape-k config's tick-iteration backstop
 * equals the prose-anchored 1000.
 *
 * @param {{ config: MapeKConfig | null, expected?: number }} args
 * @returns {CheckResult}
 */
export function checkMapeKTickIterationBackstop({ config, expected }) {
  const want = expected ?? DEFAULT_EXPECTED_BACKSTOP;
  if (config === null || config === undefined) {
    return {
      ok: false,
      reason:
        "config is null; the dormant-config short-circuit lives in the CLI, not the pure function.",
    };
  }
  const actual = resolveBackstop(config);
  if (actual === null) {
    return {
      ok: false,
      reason:
        "config has neither a `tick_iteration_backstop` nor a `tick_iteration_backstop_ticks` finite positive integer field.",
    };
  }
  if (actual !== want) {
    return {
      ok: false,
      reason: `mape-k tick-iteration-backstop drift: config has ${actual}, expected ${want} (ARCHITECTURE.md L218: "every 1000 ticks"). Fix config or update the prose anchor.`,
    };
  }
  return { ok: true };
}

/**
 * @param {MapeKConfig} config
 * @returns {number | null}
 */
function resolveBackstop(config) {
  const candidate =
    config.tick_iteration_backstop !== undefined
      ? config.tick_iteration_backstop
      : config.tick_iteration_backstop_ticks;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    !Number.isInteger(candidate) ||
    candidate <= 0
  ) {
    return null;
  }
  return candidate;
}

/**
 * Read + parse `config/mape-k.json`. Returns `null` if the file does not
 * exist (the dormant state). Throws on malformed JSON / non-object.
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
 * CLI: reads `config/mape-k.json` (or the path passed as the first
 * argument) and runs `checkMapeKTickIterationBackstop`.
 *
 * Exit codes:
 *   0 — pass, OR config missing (dormant state)
 *   1 — fail (drift detected — fix config or update prose anchor)
 *   2 — I/O error or malformed config (rule-#6 let-it-crash)
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
      `mape-k-tick-iteration-backstop: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (config === null) {
    process.stderr.write(
      `mape-k-tick-iteration-backstop advisory: ${path} not present; lint dormant until the mape-k-loop config artefact ships (rule #7 graceful degrade).\n`,
    );
    return 0;
  }

  const result = checkMapeKTickIterationBackstop({ config });
  if (!result.ok) {
    process.stderr.write(`mape-k-tick-iteration-backstop violation:\n  - ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(
    "mape-k-tick-iteration-backstop ok: tick_iteration_backstop matches the 1000 prose anchor (ARCHITECTURE.md L218).\n",
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-mape-k-tick-iteration-backstop.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
