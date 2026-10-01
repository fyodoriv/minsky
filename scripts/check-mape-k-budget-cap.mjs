#!/usr/bin/env node
// Pattern: deterministic CI gate over a rule-#9 cost-budget contract.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in ARCHITECTURE.md / vision.md /
//   research.md gets a deterministic linter as soon as the artefact it
//   guards becomes machine-readable); ARCHITECTURE.md § "MAPE-K cadence"
//   (the ≤5.7 % weekly Max5 budget cap on the autonomic manager); Beyer,
//   Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*, O'Reilly,
//   2016, Ch. 3 (error-budget enforcement — exceed-the-budget triggers a
//   mechanical response, not a discussion).
// Conformance: full — pure decision function over `{ config,
//   weeklyBudgetTokens, capFraction }`, thin CLI wrapper owns I/O, no LLM
//   in the chain.
//
// Why this gate exists: ARCHITECTURE.md § "MAPE-K cadence" caps the
// `mape-k-loop` autonomic-manager's projected weekly token cost at 5.7 %
// of the observed weekly Max5 budget. The estimate is derived in
// `research.md` § "MAPE-K cadence" — 14 watchdog passes/week × 0.3 % +
// 0–3 event passes/week × 0.5 % + a quarterly tick-iteration backstop ≤
// 5.7 % of weekly budget. Today the cap is prose-only: a future change to
// the watchdog cadence T (currently 12 h), the per-pass cost estimate, or
// the tick-iteration backstop frequency would silently breach 5.7 %
// without any CI signal. This linter reads `config/mape-k.json` (the
// future machine-readable artefact) and asserts
//   weeklyProjectedTokens / weeklyBudgetTokens ≤ capFraction (default 0.057)
// mechanically on every PR.
//
// Config shape (`config/mape-k.json`): EITHER a direct projected total —
//
//   { "weeklyProjectedTokens": <number>, "weeklyBudgetTokens": <number> }
//
// OR a derived shape (the linter computes
// `ticksPerWeek × tokensPerTick`):
//
//   { "ticksPerWeek": <number>, "tokensPerTick": <number>,
//     "weeklyBudgetTokens": <number> }
//
// `weeklyBudgetTokens` is the *observed* weekly Max5 budget per
// ARCHITECTURE.md § "Token economy" — Anthropic does not publish a fixed
// number for this tier; the watchdog (`@minsky/budget-guard`) reads it
// from `TokenMonitor` at runtime. The config persists the most-recent
// observation so the lint has a deterministic comparand. The pure
// function accepts `weeklyBudgetTokens` as an explicit argument so tests
// don't need to mock filesystems and so future config shapes (e.g.,
// embedding the budget alongside the projection) are wire-compatible.
//
// Boundary semantics: the cap is *inclusive* — a config sitting exactly
// at 5.7 % passes. This matches Beyer SRE 2016 Ch. 3's error-budget
// discipline: "you have used X % of your budget" is not a violation
// until X exceeds the budget. The alarm is the response shape (extend
// watchdog T to 18 h per `research.md` § "MAPE-K cadence"), not the
// equality.
//
// Dormant state (rule #7 — graceful degrade): if `config/mape-k.json` is
// not present (the v0 mape-k-loop ships without an externalised config),
// the lint exits 0 with a stderr advisory ("mape-k config not yet
// shipped; lint dormant"). The deterministic check activates the moment
// the config artefact lands — same precedent as `check-skill-rule-cap`'s
// retired-Skill terminal state.
//
// Pivot (rule #9, this gate): if the 5.7 % number itself moves to a
// per-tier adaptive threshold (per `mape-k-loop`'s monthly self-
// calibration — research.md § "MAPE-K cadence"), retire this lint and
// replace it with one that reads the calibrated value from the
// `mape-k-loop` Knowledge log.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "mape-k.json");
/**
 * Default cap fraction. Anchored to ARCHITECTURE.md § "MAPE-K cadence"
 * ("≤ 5.7 % of weekly Max5 budget") and research.md § "MAPE-K cadence"
 * ("Total estimated spend: ≤ 5.7 %").
 */
export const DEFAULT_CAP_FRACTION = 0.057;

/**
 * @typedef {{
 *   weeklyProjectedTokens?: number,
 *   ticksPerWeek?: number,
 *   tokensPerTick?: number
 * }} MapeKConfig
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
 */

/**
 * Pure function. Decides whether the projected weekly token cost of the
 * MAPE-K loop fits under `capFraction × weeklyBudgetTokens`.
 *
 * Resolves the projected cost from the config in this order:
 *   1. `config.weeklyProjectedTokens` if a finite positive number.
 *   2. `config.ticksPerWeek × config.tokensPerTick` if both are finite
 *      non-negative numbers.
 * Returns `{ ok: false }` when neither resolution path yields a finite
 * number — a malformed config is a lint failure (rule-#6 let-it-crash
 * for bad input shape).
 *
 * `weeklyBudgetTokens` must be a finite positive number. Zero or
 * negative values are a malformed config.
 *
 * `capFraction` defaults to 0.057 (the ARCHITECTURE.md prose anchor).
 *
 * @param {{
 *   config: MapeKConfig | null,
 *   weeklyBudgetTokens: number,
 *   capFraction?: number
 * }} args
 * @returns {CheckResult}
 */
export function checkMapeKBudgetCap({ config, weeklyBudgetTokens, capFraction }) {
  const cap = capFraction ?? DEFAULT_CAP_FRACTION;
  if (!Number.isFinite(weeklyBudgetTokens) || weeklyBudgetTokens <= 0) {
    return {
      ok: false,
      reason: `weeklyBudgetTokens must be a finite positive number; got ${String(weeklyBudgetTokens)}.`,
    };
  }
  if (!Number.isFinite(cap) || cap <= 0 || cap >= 1) {
    return {
      ok: false,
      reason: `capFraction must be a finite number in (0, 1); got ${String(cap)}.`,
    };
  }
  if (config === null || config === undefined) {
    return {
      ok: false,
      reason:
        "config is null; the dormant-config short-circuit lives in the CLI, not the pure function.",
    };
  }

  const projected = resolveProjected(config);
  if (projected === null) {
    return {
      ok: false,
      reason:
        "config has neither a finite `weeklyProjectedTokens` nor a finite `ticksPerWeek × tokensPerTick`. Provide one of the two documented shapes (see scripts/check-mape-k-budget-cap.mjs header).",
    };
  }

  const ratio = projected / weeklyBudgetTokens;
  if (ratio > cap) {
    const ratioPct = (ratio * 100).toFixed(3);
    const capPct = (cap * 100).toFixed(3);
    return {
      ok: false,
      reason: `projected weekly MAPE-K cost ${projected} tokens / weekly budget ${weeklyBudgetTokens} tokens = ${ratioPct} % exceeds the ${capPct} % cap (ARCHITECTURE.md § "MAPE-K cadence"; research.md § "MAPE-K cadence"). Either reduce per-pass cost / cadence frequency, or — if the cap itself is the wrong abstraction — fire the rule-#9 pivot in the cadence's EXPERIMENT.yaml block.`,
    };
  }
  return { ok: true };
}

/**
 * @param {MapeKConfig} config
 * @returns {number | null}
 */
function resolveProjected(config) {
  if (
    typeof config.weeklyProjectedTokens === "number" &&
    Number.isFinite(config.weeklyProjectedTokens) &&
    config.weeklyProjectedTokens >= 0
  ) {
    return config.weeklyProjectedTokens;
  }
  if (
    typeof config.ticksPerWeek === "number" &&
    typeof config.tokensPerTick === "number" &&
    Number.isFinite(config.ticksPerWeek) &&
    Number.isFinite(config.tokensPerTick) &&
    config.ticksPerWeek >= 0 &&
    config.tokensPerTick >= 0
  ) {
    return config.ticksPerWeek * config.tokensPerTick;
  }
  return null;
}

/**
 * Read + parse `config/mape-k.json`. Returns `null` if the file does not
 * exist (the dormant state). Throws if the file exists but is unreadable
 * or malformed JSON (rule-#6 let-it-crash with a precise error).
 *
 * @param {string} path
 * @returns {{ config: MapeKConfig, weeklyBudgetTokens: number } | null}
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
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  const budget = obj["weeklyBudgetTokens"];
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) {
    throw new Error(
      `mape-k config at ${path} must include a finite positive "weeklyBudgetTokens" (the most-recent observed Max5 weekly budget per ARCHITECTURE.md § "Token economy")`,
    );
  }
  /** @type {MapeKConfig} */
  const config = {};
  if (typeof obj["weeklyProjectedTokens"] === "number") {
    config.weeklyProjectedTokens = obj["weeklyProjectedTokens"];
  }
  if (typeof obj["ticksPerWeek"] === "number") {
    config.ticksPerWeek = obj["ticksPerWeek"];
  }
  if (typeof obj["tokensPerTick"] === "number") {
    config.tokensPerTick = obj["tokensPerTick"];
  }
  return { config, weeklyBudgetTokens: budget };
}

/**
 * CLI: reads `config/mape-k.json` (or the path passed as the first
 * argument) and runs `checkMapeKBudgetCap`.
 *
 * Exit codes:
 *   0 — pass, OR config missing (dormant state)
 *   1 — fail (projected cost exceeds the cap)
 *   2 — I/O error or malformed config (rule-#6 let-it-crash)
 *
 * @returns {Promise<number>}
 */
async function main() {
  const path = process.argv[2] ?? DEFAULT_CONFIG_PATH;
  /** @type {{ config: MapeKConfig, weeklyBudgetTokens: number } | null} */
  let loaded;
  try {
    loaded = readMapeKConfig(path);
  } catch (err) {
    process.stderr.write(
      `mape-k-budget-cap: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (loaded === null) {
    process.stderr.write(
      `mape-k-budget-cap advisory: ${path} not present; lint dormant until the mape-k-loop config artefact ships (rule #7 graceful degrade).\n`,
    );
    return 0;
  }

  const result = checkMapeKBudgetCap({
    config: loaded.config,
    weeklyBudgetTokens: loaded.weeklyBudgetTokens,
  });
  if (!result.ok) {
    process.stderr.write(`mape-k-budget-cap violation:\n  - ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(
    `mape-k-budget-cap ok: projected weekly MAPE-K cost ≤ ${(DEFAULT_CAP_FRACTION * 100).toFixed(1)} % of weekly Max5 budget.\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-mape-k-budget-cap.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
