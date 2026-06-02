#!/usr/bin/env node
// Pattern: deterministic CI gate over a rule-#9 pre-registration record field.
// Source: rule #10 (vision.md § 10 — deterministic enforcement; ratchet rule:
//   when an advisory rule is promoted to a deterministic linter, the advisory
//   counterpart is removed in the same PR); Ries, *The Lean Startup*, 2011
//   (build-measure-learn / pivot-or-persevere — a pivot threshold equal to
//   the success threshold carries no information; it is theatre);
//   spec-advisories/2026-05-03-quarterly-audit.md (audit decision to promote
//   spec-monitor advisory rule A2 to a deterministic gate).
// Conformance: full — pure decision function over `{ success, pivot }`,
//   thin CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: spec-monitor's advisory rule A2 ("pivot threshold
// reuses the success threshold or has zero margin") was the residual-
// judgement layer over rule #9. Promoting it deterministically catches the
// failure mode mechanically on every PR rather than depending on a human
// reading the advisory file. A pivot threshold within <1 % of the success
// threshold (or exactly equal) is, per Ries 2011, a vanity threshold — it
// guarantees the experiment will register a pivot signal at the same instant
// the success criterion fails, which is uninformative.
//
// The lint inspects the EXPERIMENT.yaml at the repo root by default (or the
// path passed as the first CLI argument). It uses `@minsky/experiment-record`'s
// parser to read the `success` and `pivot` fields, then applies the pure
// decision function below.
//
// Numeric extraction: scans each string left-to-right for the first signed
// number-like token (optional `-`/`+`, integer + optional fractional part,
// optional `%`/units). Examples (input → extracted leading number):
//   "≥10"           → 10
//   "< 0"           → 0
//   "95%"           → 95
//   "100% coverage" → 100
//   "tests pass"    → null (no numeric)
//
// Margin rule (when both sides have a numeric): fail if
//   |success - pivot| / max(|success|, 1) < 0.01
// Exact equality also fails (covered by the same inequality with 0).
//
// Binary rule (when neither side has a numeric): if `success === pivot`
// after trimming and lowercasing, fail. If they differ but neither has a
// numeric, emit an advisory warning (exit 0) — the long-tail prose case
// stays advisory, since the deterministic layer cannot read meaning.
//
// Mixed rule (one side has a numeric, the other doesn't): advisory warning
// (exit 0). Either side may legitimately be a richer narrative; we only
// fail on the deterministically clear case.
//
// Opt-out (only meaningful for the binary-equal case — legitimately-binary
// metrics): the EXPERIMENT.yaml may contain a top-level YAML comment line
//   # rule: ci-lint-pivot-success-margin: skip <reason ≥3 chars>
// in which case the lint passes regardless of margin. Audited at quarterly
// review per spec-advisories/2026-05-03-quarterly-audit.md.
//
// Pivot (rule #9, this gate): if numeric-token extraction proves brittle
// (>10 % false-positive rate against historical EXPERIMENT.yaml records),
// keep A2 advisory in spec-monitor and close the promotion task. This is
// recorded in EXPERIMENT.yaml's `pivot` field for the shipping PR.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Workspace import — `@minsky/experiment-record` is built to `dist/` by
// `pnpm build` in the package's CI step. Vitest resolves the workspace
// `src/` directly via `vitest.config.ts`, so tests don't need a pre-build.
import { parse as parseExperimentRecord } from "@minsky/experiment-record";

import { getHostRoot } from "./lib/host-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
// Per `host-root-resolver-prep`: parametric experiments root via MINSKY_HOST_ROOT.
const DEFAULT_EXPERIMENTS_DIR = resolve(getHostRoot(REPO_ROOT), "experiments");

// Regex matches the first signed-numeric token in a string. Allows an
// optional leading `+` / `-`, requires at least one digit, allows an
// optional fractional part. Trailing `%`/units are NOT captured (we only
// care about the numeric value). The regex is anchored to the first
// occurrence; everything before it is consumed by `.*?`-free scanning via
// the `String.prototype.match` semantics with no `^` anchor.
const NUMERIC_TOKEN_RE = /([+-]?\d+(?:\.\d+)?)/;

const SKIP_COMMENT_RE =
  /^[ \t]*#[ \t]*rule:[ \t]*ci-lint-pivot-success-margin:[ \t]*skip[ \t]+(\S.{2,})$/m;

const MARGIN_FRACTION = 0.01;

/**
 * @typedef {{ ok: true, reason?: string, warning?: string }} OkResult
 * @typedef {{ ok: false, reason: string }} FailResult
 * @typedef {OkResult | FailResult} CheckResult
 */

/**
 * Extract the leading signed numeric token from a string. Returns `null`
 * when the string contains no number-like token.
 *
 * @param {string} s
 * @returns {number | null}
 */
export function extractLeadingNumber(s) {
  const m = s.match(NUMERIC_TOKEN_RE);
  if (m === null || m[1] === undefined) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Pure function. Decides whether a `{ success, pivot }` pair has a
 * meaningful numeric or binary margin between the two thresholds.
 *
 * Decision table:
 *
 *   both numeric, margin <1 %  → fail (deterministic)
 *   both numeric, margin ≥1 %  → ok
 *   neither numeric, equal     → fail (binary equality)
 *   neither numeric, differ    → ok with warning (advisory long-tail)
 *   one numeric, one not       → ok with warning (mixed)
 *
 * @param {{ success: string, pivot: string }} input
 * @returns {CheckResult}
 */
export function checkPivotSuccessMargin({ success, pivot }) {
  const sNum = extractLeadingNumber(success);
  const pNum = extractLeadingNumber(pivot);

  if (sNum !== null && pNum !== null) {
    const diff = Math.abs(sNum - pNum);
    const denom = Math.max(Math.abs(sNum), 1);
    const ratio = diff / denom;
    if (ratio < MARGIN_FRACTION) {
      return {
        ok: false,
        reason: `pivot/success margin too small: success=${sNum}, pivot=${pNum}, |Δ|/max(|success|,1)=${ratio.toFixed(4)} < ${MARGIN_FRACTION}. Per Ries 2011 (pivot-or-persevere), a zero-margin pivot threshold is theatre — pick a pivot value at least 1 % distant from the success threshold (or use a different metric on the pivot side).`,
      };
    }
    return { ok: true };
  }

  if (sNum === null && pNum === null) {
    const sNorm = success.trim().toLowerCase();
    const pNorm = pivot.trim().toLowerCase();
    if (sNorm === pNorm && sNorm.length > 0) {
      return {
        ok: false,
        reason: `pivot is identical to success (binary equality): "${success}" / "${pivot}". This is the spec-monitor A2 'tests pass / tests fail' shape with no semantic distance; restate the pivot as a numeric threshold or add the opt-out comment "# rule: ci-lint-pivot-success-margin: skip <reason>" if the metric is legitimately binary.`,
      };
    }
    return {
      ok: true,
      warning: `neither success nor pivot has a leading numeric token; advisory layer (spec-monitor) covers the residual judgement. success="${success}", pivot="${pivot}".`,
    };
  }

  // Mixed: one side is numeric, the other is prose.
  return {
    ok: true,
    warning: `only one of {success, pivot} has a leading numeric token; deterministic margin check is not applicable. success="${success}", pivot="${pivot}".`,
  };
}

/**
 * Detect the inline opt-out comment in raw EXPERIMENT.yaml content.
 *
 * @param {string} rawYaml
 * @returns {{ skip: true, reason: string } | { skip: false }}
 */
export function detectSkipComment(rawYaml) {
  const m = rawYaml.match(SKIP_COMMENT_RE);
  if (m === null || m[1] === undefined) return { skip: false };
  return { skip: true, reason: m[1].trim() };
}

/**
 * CLI: reads EXPERIMENT.yaml (path defaults to repo root), parses it via
 * `@minsky/experiment-record`, and runs `checkPivotSuccessMargin`.
 *
 * Exit codes:
 *   0 — pass, or pass-with-warning, or skip-comment honoured
 *   1 — fail (deterministic margin or binary equality)
 *   2 — I/O error or parse failure (rule-#6 let-it-crash with precise error)
 *
 * @returns {Promise<number>}
 */
/**
 * @param {string} pathArg
 */
async function main(pathArg) {
  const path = pathArg;
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(
      `pivot-success-margin: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const skip = detectSkipComment(raw);
  if (skip.skip) {
    process.stdout.write(
      `pivot-success-margin ok: skipped via opt-out comment ("${skip.reason}").\n`,
    );
    return 0;
  }

  // Use the experiment-record parser so the gate stays in lockstep with
  // the rest of rule #9's enforcement (rule #1: don't reinvent the wheel).
  const parsed = parseExperimentRecord(raw);
  if (!parsed.ok) {
    process.stderr.write(
      `pivot-success-margin: ${path} did not parse as a valid EXPERIMENT.yaml; rerun the experiment-record validator first.\n`,
    );
    for (const e of parsed.errors) process.stderr.write(`  - ${e.kind}: ${e.message}\n`);
    return 2;
  }

  const { success, pivot } = parsed.record;
  const result = checkPivotSuccessMargin({ success, pivot });
  if (!result.ok) {
    process.stderr.write(`pivot-success-margin violation:\n  - ${result.reason}\n`);
    return 1;
  }
  if (result.warning !== undefined) {
    process.stdout.write(`pivot-success-margin advisory: ${result.warning}\n`);
    return 0;
  }
  process.stdout.write(
    `pivot-success-margin ok: success/pivot margin meaningful (numeric Δ ≥ ${MARGIN_FRACTION * 100} %).\n`,
  );
  return 0;
}

/**
 * Walk a directory of `experiments/*.yaml` files, run `main(file)` per file,
 * and aggregate exit codes (max wins). Per `experiments-directory-migration`:
 * the singleton EXPERIMENT.yaml at the repo root was retired in favour of
 * plural `experiments/<id>.yaml`. The walker is the directory-mode entry;
 * per-file `main(file)` remains for explicit single-file invocation.
 *
 * @param {string} directoryPath
 * @returns {Promise<number>}
 */
export async function mainDirectory(directoryPath) {
  let entries;
  try {
    entries = readdirSync(directoryPath);
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") {
      process.stdout.write(
        `pivot-success-margin ok: ${directoryPath} not found (handled by ci-experiment-runner gate).\n`,
      );
      return 0;
    }
    throw err;
  }
  const yamlFiles = entries
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .map((name) => join(directoryPath, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  if (yamlFiles.length === 0) {
    process.stdout.write(
      `pivot-success-margin ok: ${directoryPath} has no *.yaml files (nothing to check).\n`,
    );
    return 0;
  }
  let maxExitCode = 0;
  for (const file of yamlFiles) {
    const code = await main(file);
    if (code > maxExitCode) maxExitCode = code;
  }
  return maxExitCode;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-pivot-success-margin.mjs");
if (invokedDirectly) {
  const arg = process.argv[2] ?? DEFAULT_EXPERIMENTS_DIR;
  let isDir = false;
  try {
    isDir = statSync(arg).isDirectory();
  } catch {
    isDir = false;
  }
  const code = isDir ? await mainDirectory(arg) : await main(arg);
  process.exit(code);
}
