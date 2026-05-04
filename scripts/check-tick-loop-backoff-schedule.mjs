#!/usr/bin/env node
// Pattern: deterministic CI gate over a prose-only restart-backoff schedule.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet
//   rule: every prose-only invariant in ARCHITECTURE.md / vision.md /
//   research.md gets a deterministic linter as soon as the artefact it
//   guards becomes machine-readable); ARCHITECTURE.md L215 ("`tick-loop`
//   uses backoff (5s → 30s → 5min) to avoid hammering on systematic
//   failures"); Armstrong, *Programming Erlang*, Pragmatic Bookshelf
//   2007 (let-it-crash + supervised restart with backoff); Beyer, Jones,
//   Petoff, Murphy (eds.), *Site Reliability Engineering*, O'Reilly
//   2016, Ch. 3 (error-budget enforcement — exceed-the-budget triggers a
//   mechanical response, not a discussion).
// Conformance: full — pure decision function over `{ config, expected }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: ARCHITECTURE.md L215 anchors the supervisor's
// tick-loop restart-backoff ladder at the literal `5s → 30s → 5min`. The
// supervisor unit-file templates (`distribution/`) ship with this ladder
// today as a hard-coded shell value. The future `config/tick-loop.json`
// artefact will externalise it; once it lands, drift between
// ARCHITECTURE.md and the runtime config could silently extend the ramp
// (e.g., `[5, 30, 600]` — 10× the operator-visible MTTR target on the
// terminal step) without any CI signal. This linter reads the future
// `config/tick-loop.json` and asserts its `backoff_schedule` (or
// `backoff_schedule_seconds` — both shapes accepted, see below) field
// equals `[5, 30, 300]` mechanically on every PR.
//
// Config shape (`config/tick-loop.json`): an object with EITHER
// `backoff_schedule` OR `backoff_schedule_seconds` — both are arrays of
// non-negative finite numbers (seconds). The two field names are
// accepted because the prose anchor uses neither — the field name will
// be picked when the artefact lands. The lint pass-condition is
// strict-deep-equality against `[5, 30, 300]`.
//
// Dormant state (rule #7 — graceful degrade): if `config/tick-loop.json`
// is not present (the v0 supervisor unit-file ships before the
// externalised config), the lint exits 0 with a stderr advisory
// ("config not yet shipped; lint dormant"). The deterministic check
// activates the moment the config artefact lands — same precedent as
// `check-mape-k-budget-cap`'s dormant-config short-circuit.
//
// Pivot (rule #9, this gate): if the fixed `5s → 30s → 5min` ladder is
// replaced by exponential backoff or a different ramp shape (per a
// future ARCHITECTURE.md amendment), retire this lint and replace it
// with one that asserts the new shape's invariants.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "tick-loop.json");

/**
 * Default expected backoff schedule. Anchored to ARCHITECTURE.md L215
 * ("backoff (5s → 30s → 5min)"). Frozen so a silent edit to the default
 * is a loud test failure (rule-#10 ratchet — drift requires an
 * EXPERIMENT.yaml pivot, not a one-line PR).
 */
export const DEFAULT_EXPECTED_SCHEDULE = Object.freeze([5, 30, 300]);

/**
 * @typedef {{
 *   backoff_schedule?: unknown,
 *   backoff_schedule_seconds?: unknown
 * }} TickLoopConfig
 *
 * @typedef {{ ok: true } | { ok: false, reason: string }} CheckResult
 */

/**
 * Pure function. Asserts the tick-loop config's backoff schedule deep-
 * equals the prose-anchored `[5, 30, 300]` (seconds).
 *
 * `expectedSchedule` defaults to {@link DEFAULT_EXPECTED_SCHEDULE}.
 *
 * @param {{
 *   config: TickLoopConfig | null,
 *   expectedSchedule?: ReadonlyArray<number>
 * }} args
 * @returns {CheckResult}
 */
export function checkTickLoopBackoffSchedule({ config, expectedSchedule }) {
  const expected = expectedSchedule ?? DEFAULT_EXPECTED_SCHEDULE;
  if (config === null || config === undefined) {
    return {
      ok: false,
      reason:
        "config is null; the dormant-config short-circuit lives in the CLI, not the pure function.",
    };
  }
  const actual = resolveSchedule(config);
  if (actual === null) {
    return {
      ok: false,
      reason:
        "config has neither a `backoff_schedule` nor a `backoff_schedule_seconds` array of finite non-negative numbers. Provide one of the two shapes (see scripts/check-tick-loop-backoff-schedule.mjs header).",
    };
  }
  if (!arraysEqual(actual, expected)) {
    return {
      ok: false,
      reason: `tick-loop backoff schedule drift: config has ${JSON.stringify(actual)}, expected ${JSON.stringify(Array.from(expected))} (ARCHITECTURE.md L215: "backoff (5s → 30s → 5min)"). Fix config or update the prose anchor.`,
    };
  }
  return { ok: true };
}

/**
 * @param {TickLoopConfig} config
 * @returns {number[] | null}
 */
function resolveSchedule(config) {
  const candidate =
    config.backoff_schedule !== undefined
      ? config.backoff_schedule
      : config.backoff_schedule_seconds;
  if (!Array.isArray(candidate)) return null;
  /** @type {number[]} */
  const out = [];
  for (const v of candidate) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    out.push(v);
  }
  return out;
}

/**
 * @param {ReadonlyArray<number>} a
 * @param {ReadonlyArray<number>} b
 * @returns {boolean}
 */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Read + parse `config/tick-loop.json`. Returns `null` if the file does
 * not exist (the dormant state). Throws if the file exists but is
 * unreadable or malformed JSON (rule-#6 let-it-crash with a precise
 * error).
 *
 * @param {string} path
 * @returns {TickLoopConfig | null}
 */
export function readTickLoopConfig(path) {
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
    throw new Error(`tick-loop config at ${path} must be a JSON object`);
  }
  return /** @type {TickLoopConfig} */ (parsed);
}

/**
 * CLI: reads `config/tick-loop.json` (or the path passed as the first
 * argument) and runs `checkTickLoopBackoffSchedule`.
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
  /** @type {TickLoopConfig | null} */
  let config;
  try {
    config = readTickLoopConfig(path);
  } catch (err) {
    process.stderr.write(
      `tick-loop-backoff-schedule: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (config === null) {
    process.stderr.write(
      `tick-loop-backoff-schedule advisory: ${path} not present; lint dormant until the tick-loop config artefact ships (rule #7 graceful degrade).\n`,
    );
    return 0;
  }

  const result = checkTickLoopBackoffSchedule({ config });
  if (!result.ok) {
    process.stderr.write(`tick-loop-backoff-schedule violation:\n  - ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(
    "tick-loop-backoff-schedule ok: backoff_schedule matches the [5, 30, 300] prose anchor (ARCHITECTURE.md L215).\n",
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-tick-loop-backoff-schedule.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
