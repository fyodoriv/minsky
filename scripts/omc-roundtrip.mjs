#!/usr/bin/env node
// Pattern: round-trip parsing as a parseability test.
// Source: Aho, Sethi, Ullman, *Compilers: Principles, Techniques, and
//   Tools*, Addison-Wesley, 1986 (round-trip property — a serializer is
//   parseable iff `parse(serialize(parse(s))) ≡ parse(s)` modulo
//   whitespace; the v0 check tightens to byte-equal modulo whitespace
//   because OMC's serializer is JSON.stringify-with-indent-2, which is
//   deterministic for a given parsed value).
// Anchor: rule #2 (vision.md § 2 — every dep behind interface; the OMC
//   bridge is exactly that, and the parseability test gates the
//   interface contract); research.md § "OMC handoff persistence"
//   (verdict: parseable; canonical write site
//   `src/team/state/tasks.ts:90` writes
//   `JSON.stringify(updated, null, 2)`).
// Conformance: full — pure decision function `roundTripOmcTask(json)`,
//   thin CLI wrapper owns I/O, no LLM in the chain, dormant short-
//   circuit when no OMC checkout is provided.
//
// Why this gate exists: PR #75's read-only research established that
// OMC persists each `/team` task as a pretty-printed JSON file at
// `<repoRoot>/.omc/state/team/<teamName>/tasks/<taskId>.json` (see
// research.md § "OMC handoff persistence"). Before `omc-tasksmd-bridge-
// v0` ships as a thin reader, the parseability claim must be testable:
// a future OMC release that switches to e.g. an opaque encoding (LZ4
// blobs, sorted-by-write-time CBOR, etc.) would silently break the
// bridge. This script — when pointed at a real OMC checkout via
// `--omc-checkout=<path>` — round-trips every `tasks/*.json` file
// (parse → JSON.stringify-with-indent-2 → diff against original) and
// fails on the first non-whitespace divergence.
//
// Dormant state (rule #7 — graceful degrade): if no `--omc-checkout=`
// is supplied OR the path has no `.omc/state/team/` subdir, the script
// exits 0 with a stderr advisory. Same precedent as
// `check-mape-k-budget-cap.mjs`'s dormant-on-missing-config short-
// circuit.
//
// Pivot (rule #9, this gate): if the round-trip check reveals a
// non-whitespace diff against any sample (i.e., OMC's JSON serialiser
// is non-deterministic — keys reordered, numbers reformatted, etc.),
// the parseable-thin-reader hypothesis is disproved; restore the
// research task and re-investigate. Do not patch the diff comparison
// to ignore the divergence — that masks the disproof.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
void HERE;

/**
 * @typedef {{ ok: true } | { ok: false, diff: string }} RoundTripResult
 */

/**
 * Pure function. Round-trips a single OMC task JSON string.
 *
 * Steps:
 *   1. `JSON.parse(taskJson)` — fails if not valid JSON.
 *   2. `JSON.stringify(parsed, null, 2)` — re-emits in the canonical
 *      OMC shape (`src/team/state/tasks.ts:90` —
 *      `writeAtomic(path, JSON.stringify(updated, null, 2))`).
 *   3. Compare emitted bytes against the original, after stripping
 *      trailing whitespace per line and collapsing the file's trailing
 *      newline. Whitespace-only differences are accepted; any
 *      structural difference fails.
 *
 * @param {string} taskJson
 * @returns {RoundTripResult}
 */
export function roundTripOmcTask(taskJson) {
  if (typeof taskJson !== "string") {
    return {
      ok: false,
      diff: `expected a string; got ${typeof taskJson}.`,
    };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(taskJson);
  } catch (err) {
    return {
      ok: false,
      diff: `parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      diff: "expected a JSON object at the top level (TaskFile shape per src/team/types.ts:38-58, 195-213).",
    };
  }
  const reEmitted = JSON.stringify(parsed, null, 2);
  const a = normaliseWhitespace(taskJson);
  const b = normaliseWhitespace(reEmitted);
  if (a === b) {
    return { ok: true };
  }
  return {
    ok: false,
    diff: firstStructuralDiff(a, b),
  };
}

/**
 * Strip per-line trailing whitespace; collapse all trailing newlines
 * into exactly zero so the comparison is byte-equal modulo whitespace.
 * @param {string} s
 * @returns {string}
 */
function normaliseWhitespace(s) {
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "");
}

/**
 * Compute a short human-readable diff hint at the first divergence
 * between `a` and `b`. Used only for failure messages — not load-
 * bearing.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function firstStructuralDiff(a, b) {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  const start = Math.max(0, i - 20);
  const aSlice = a.slice(start, i + 40);
  const bSlice = b.slice(start, i + 40);
  return `divergence at byte ${i}: original≈${JSON.stringify(aSlice)} vs re-emitted≈${JSON.stringify(bSlice)}`;
}

/**
 * Walk an OMC checkout's `.omc/state/team/<teamName>/tasks/` dirs and
 * yield absolute paths to `*.json` task files. Returns an empty array
 * if no `.omc/state/team` subdir exists (the dormant case).
 *
 * @param {string} omcCheckout
 * @returns {string[]}
 */
export function findOmcTaskFiles(omcCheckout) {
  const teamRoot = join(omcCheckout, ".omc", "state", "team");
  if (!isReadableDir(teamRoot)) return [];
  /** @type {string[]} */
  const out = [];
  for (const teamName of readdirSync(teamRoot)) {
    const tasksDir = join(teamRoot, teamName, "tasks");
    for (const name of readDirOrEmpty(tasksDir)) {
      if (name.endsWith(".json")) out.push(join(tasksDir, name));
    }
  }
  return out;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isReadableDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * `readdirSync(path)` that returns `[]` for ENOENT / ENOTDIR (the
 * cases the caller treats as empty). All other errors propagate.
 * @param {string} path
 * @returns {string[]}
 */
function readDirOrEmpty(path) {
  try {
    return readdirSync(path);
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
    throw err;
  }
}

/**
 * Parse `--omc-checkout=<path>` from argv. Returns `null` if absent.
 * @param {string[]} argv
 * @returns {string | null}
 */
export function parseOmcCheckoutFlag(argv) {
  for (const arg of argv) {
    if (arg.startsWith("--omc-checkout=")) {
      const value = arg.slice("--omc-checkout=".length);
      if (value.length === 0) return null;
      return resolve(value);
    }
  }
  return null;
}

/**
 * CLI: round-trip every task file under `<omc-checkout>/.omc/state/
 * team/*\/tasks/*.json`.
 *
 * Exit codes:
 *   0 — pass (all files round-trip), OR dormant (no `--omc-checkout=`,
 *       OR path has no `.omc/state/team/` subdir)
 *   1 — fail (at least one file diverges)
 *   2 — I/O error reading a task file
 *
 * @returns {Promise<number>}
 */
async function main() {
  const argv = process.argv.slice(2);
  const omcCheckout = parseOmcCheckoutFlag(argv);
  if (omcCheckout === null) {
    process.stderr.write(
      'omc-roundtrip advisory: no --omc-checkout=<path> supplied; lint dormant (rule #7 graceful degrade). See research.md § "OMC handoff persistence" for the canonical layout.\n',
    );
    return 0;
  }
  const files = findOmcTaskFiles(omcCheckout);
  if (files.length === 0) {
    process.stderr.write(
      `omc-roundtrip advisory: ${omcCheckout} has no .omc/state/team/<team>/tasks/*.json files; lint dormant.\n`,
    );
    return 0;
  }
  for (const path of files) {
    /** @type {string} */
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      process.stderr.write(
        `omc-roundtrip: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 2;
    }
    const result = roundTripOmcTask(raw);
    if (!result.ok) {
      process.stderr.write(`omc-roundtrip violation at ${path}:\n  - ${result.diff}\n`);
      return 1;
    }
  }
  process.stdout.write(
    `omc-roundtrip ok: ${files.length} task file(s) round-tripped under ${omcCheckout}/.omc/state/team/.\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("omc-roundtrip.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
