#!/usr/bin/env node
// Pattern: deterministic CI gate over a calm-tech display-arity invariant.
// Source: rule #10 (vision.md § 10 — deterministic enforcement: a prose
//   invariant that nothing mechanically checks is one PR away from silent
//   regression); rule #6 (failure-mode discipline — "did anyone notice the
//   surface grew a 4th value?" is itself a failure mode, so close it
//   mechanically); Card, Mackinlay, Shneiderman, *Readings in Information
//   Visualization*, 1999 (the glanceable 3-number display); Weiser & Brown
//   1995 (calm technology — the wrist surface must stay at-a-glance).
// Conformance: full — pure function + thin CLI wrapper, no LLM in the chain.
//
// Why this gate exists: user-story 005 + vision.md success #6 (wrist dwell)
// fix the Watch surface at EXACTLY three readings. The cap lives only as
// prose plus the `WATCH_METRIC_IDS` object literal in
// `novel/dashboard-web/src/watch.ts` (currently three keys:
// tokens-remaining, last-task-status, constraint-of-the-week). Nothing
// prevented a future PR from adding a fourth key and silently bloating the
// glanceable surface back into a notification-heavy dashboard. This gate
// parses the literal and fails when the key count exceeds three.
//
// The contract shape (locked to what `watch.ts` exports today):
//
//   export const WATCH_METRIC_IDS = {
//     "tokens-remaining": "token-budget-honoring",
//     "last-task-status": "task-throughput",
//     "constraint-of-the-week": "self-improvement-velocity",
//   } as const;
//
// We parse the literal from source text rather than importing the compiled
// module so the gate is self-contained (no build dependency) — same shape as
// `check-skill-rule-cap.mjs`, which reads SKILL.md rather than executing it.
// The parser isolates the `{ ... }` body of the `WATCH_METRIC_IDS`
// declaration and counts top-level `"<key>":` entries. Drift in the literal
// shape is a deliberate cost: if `watch.ts` changes how the mapping is
// declared, this linter must be updated in the same PR (failure becomes
// loud, not silent).
//
// Pivot (rule #9): if story 005's ship-shape changes so the three readings
// collapse into a single composite gauge (the cap is no longer "key count"),
// retire this lint and write the new one against the shipped artefact. A
// missing contract file is therefore treated as a pass: a contract that no
// longer exists cannot violate its own arity cap (mirrors the retired-Skill
// terminal state in check-skill-rule-cap.mjs).
//
// Hypothesis (this gate's reason for existing): a deterministic key-count
// check converts the prose 3-value invariant into a mechanical gate that
// catches the 4th-key regression at PR time. Success: exits 1 on a synthetic
// 4-key contract, exits 0 on the real 3-key literal, exits 0 on a missing
// contract. Measurement: `node scripts/check-watch-surface-cap.mjs && pnpm
// exec vitest run scripts/check-watch-surface-cap.test.mjs`. Anchor: Card,
// Mackinlay, Shneiderman 1999; vision.md rule #10.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACT_PATH = resolve(HERE, "..", "novel", "dashboard-web", "src", "watch.ts");
const DEFAULT_MAX_VALUES = 3;

// The `WATCH_METRIC_IDS` object-literal declaration head, up to the opening
// brace. `export` is optional so the parser also matches a non-exported test
// fixture. Multiline-insensitive on purpose — the declaration sits on one
// line in `watch.ts`.
const DECL_RE = /(?:export\s+)?const\s+WATCH_METRIC_IDS\s*=\s*\{/;

// A top-level key entry inside the literal: a double-quoted (or single-quoted
// / bare-identifier) property name followed by a colon. Anchored to line
// start (after trimming) so a colon inside a string value can't be miscounted
// as a key.
const KEY_RE = /^\s*(?:"[^"]+"|'[^']+'|[A-Za-z_$][\w$]*)\s*:/;

/**
 * @typedef {{ valueCount: number, violation: string | null }} CheckResult
 */

/**
 * Extract the `{ ... }` body of the `WATCH_METRIC_IDS` declaration from
 * `contractContent` by brace-matching from the declaration's opening brace.
 * Returns `null` when the declaration is absent (treated by the caller as a
 * retired contract — the rule-#9 Pivot terminal state).
 *
 * @param {string} contractContent
 * @returns {string | null} the literal body (without the outer braces), or null
 */
export function extractWatchMetricLiteralBody(contractContent) {
  const declMatch = DECL_RE.exec(contractContent);
  if (declMatch === null) return null;
  // Index of the opening brace (the char before the match end is `{`).
  const open = declMatch.index + declMatch[0].length - 1;
  let depth = 0;
  for (let i = open; i < contractContent.length; i += 1) {
    const ch = contractContent[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return contractContent.slice(open + 1, i);
    }
  }
  // Unbalanced braces — malformed source. Let the caller treat a null body
  // as "no resolvable contract" rather than crash; the typecheck/biome gates
  // own malformed-TS detection (rule #6 — one gate per failure class).
  return null;
}

/**
 * Net brace/bracket nesting change across a line: `+1` per `{`/`[`, `-1` per
 * `}`/`]`. Extracted from `countTopLevelKeys` to keep that function's cognitive
 * complexity below the biome cap (rule #10 — the lint that gates this gate).
 *
 * @param {string} line
 * @returns {number}
 */
function netDepthDelta(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{" || ch === "[") delta += 1;
    else if (ch === "}" || ch === "]") delta -= 1;
  }
  return delta;
}

/**
 * Count the top-level `"<key>":` entries in a literal body. Only the outermost
 * nesting level is counted, so a nested object value (none today, but
 * future-proof) does not inflate the count.
 *
 * @param {string} body
 * @returns {number}
 */
export function countTopLevelKeys(body) {
  let count = 0;
  let depth = 0;
  for (const rawLine of body.split("\n")) {
    // Track brace depth across lines so nested-object values are skipped.
    if (depth === 0 && KEY_RE.test(rawLine)) count += 1;
    depth = Math.max(0, depth + netDepthDelta(rawLine));
  }
  return count;
}

/**
 * Pure function: count the keys of the `WATCH_METRIC_IDS` literal in
 * `contractContent` and return a violation message when the count exceeds
 * `maxValues`. Returns `{ valueCount: 0, violation: null }` for empty / null
 * content OR when the declaration is absent (treated as a retired contract —
 * the rule-#9 Pivot terminal state, mirroring check-skill-rule-cap.mjs).
 *
 * @param {{ contractContent: string | null, maxValues: number }} args
 * @returns {CheckResult}
 */
export function checkWatchSurfaceCap({ contractContent, maxValues }) {
  if (contractContent === null || contractContent === "") {
    return { valueCount: 0, violation: null };
  }
  const body = extractWatchMetricLiteralBody(contractContent);
  if (body === null) {
    // No `WATCH_METRIC_IDS` declaration found — retired/renamed contract.
    return { valueCount: 0, violation: null };
  }
  const valueCount = countTopLevelKeys(body);
  if (valueCount > maxValues) {
    return {
      valueCount,
      violation: `WATCH_METRIC_IDS has ${valueCount} keys; the Watch surface is capped at ${maxValues} readings (user-story 005, vision.md success #6 — wrist dwell; Card & Mackinlay 1999). Either drop a key or re-spec the glanceable surface and retire this gate (vision.md § 10).`,
    };
  }
  return { valueCount, violation: null };
}

// Re-exported for tests so they can lock the regex shapes independently of
// the `checkWatchSurfaceCap` entry point.
export { DECL_RE, KEY_RE };

/**
 * CLI: reads `novel/dashboard-web/src/watch.ts` (or the path passed as the
 * first argument) and exits 1 if the key count > max. Missing file is a pass
 * (retired contract is the rule-#9 Pivot terminal state, not a violation).
 *
 * @returns {Promise<number>}
 */
async function main() {
  const contractPath = process.argv[2] ?? DEFAULT_CONTRACT_PATH;
  /** @type {string | null} */
  let contractContent;
  try {
    contractContent = readFileSync(contractPath, "utf8");
  } catch (err) {
    // ENOENT → retired contract, terminal state per the rule-#9 Pivot.
    // Anything else is unexpected I/O and should bubble (rule #6:
    // let-it-crash with a precise error).
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      process.stdout.write(
        `watch-surface-cap ok: ${contractPath} not found (treated as retired contract, rule-#9 Pivot terminal state).\n`,
      );
      return 0;
    }
    throw err;
  }
  const result = checkWatchSurfaceCap({ contractContent, maxValues: DEFAULT_MAX_VALUES });
  if (result.violation === null) {
    process.stdout.write(
      `watch-surface-cap ok: ${result.valueCount} Watch reading(s) declared (cap ${DEFAULT_MAX_VALUES}).\n`,
    );
    return 0;
  }
  process.stderr.write(`watch-surface-cap violation:\n  - ${result.violation}\n`);
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-watch-surface-cap.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
