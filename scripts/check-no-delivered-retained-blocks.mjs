#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved stale-delivered-block-ci-gate — deterministic CI gate, no novel UX surface -->
// check-no-delivered-retained-blocks — rejects any TASKS.md diff that
// introduces a `**Blocked**:` field containing the substring
// `DELIVERED.*block retained`, preventing re-accumulation of the stale
// citation pattern that `sweep-stale-delivered-task-blocks` cleans up.
//
// Diff-scoped by default: in CI/pre-push mode (no explicit path arg) the
// gate inspects only lines ADDED to TASKS.md in this branch vs the diff
// base (env NO_DELIVERED_BLOCKS_DIFF_BASE, default origin/main). This
// is the ratchet model — the 30 pre-existing stale blocks are swept by
// `sweep-stale-delivered-task-blocks`; new additions are blocked here.
// With an explicit path arg the gate checks the whole file (for post-sweep
// verification: `node check-no-delivered-retained-blocks.mjs TASKS.md`).
//
// Pattern: deterministic gate over TASKS.md (rule #10). Pure grep — no
// LLM, no network, no side effects. Target wall-clock <100ms.
//
// Source: task `stale-delivered-block-ci-gate` (P0, M1); vision.md rule
// #10 (deterministic enforcement); Hunt & Thomas, *The Pragmatic
// Programmer* 1999 Ch. 8 — "Don't Live with Broken Windows": each
// unaddressed stale block raises tolerance for the next; a CI gate is
// the mechanical zero-tolerance policy that closes the accumulation loop.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const DEFAULT_DIFF_BASE = process.env["NO_DELIVERED_BLOCKS_DIFF_BASE"] ?? "origin/main";

/**
 * Regex matching the stale retained-block pattern specifically in a
 * `**Blocked**:` field line. Anchored to the start of line so a
 * `**Details**:` field that MENTIONS the pattern as a code example
 * (like `sweep-stale-task-blocks`'s Details field) does not false-positive.
 * Per the Pivot threshold in task `stale-delivered-block-ci-gate`.
 */
export const STALE_PATTERN = /^\s*-\s+\*\*Blocked\*\*:.*DELIVERED.*block retained/;

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {{ line: number, text: string }[]} violations
 */

/**
 * Scan text for stale delivered-retained-block patterns.
 * In diff-scoped mode pass only the added lines; for whole-file
 * verification pass the full TASKS.md content.
 *
 * @param {string} content
 * @returns {CheckResult}
 */
export function checkNoDeliveredRetainedBlocks(content) {
  const lines = content.split("\n");
  /** @type {{ line: number, text: string }[]} */
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (STALE_PATTERN.test(line)) {
      violations.push({ line: i + 1, text: line.trim() });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Extract lines added to TASKS.md in the diff of diffBase...HEAD.
 * Returns null if not in a git repo or TASKS.md has no diff.
 *
 * @param {string} diffBase
 * @returns {string | null}
 */
export function getAddedLines(diffBase) {
  try {
    const diff = execSync(`git diff ${diffBase}...HEAD -- TASKS.md`, {
      encoding: "utf8",
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const added = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n");
    return added;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- CLI -------

if (import.meta.url === `file://${process.argv[1]}`) {
  const explicitPath = process.argv[2];

  let content;
  let modeLabel;

  if (explicitPath) {
    // Whole-file mode: used for post-sweep verification
    content = readFileSync(explicitPath, "utf8");
    modeLabel = `whole-file (${explicitPath})`;
  } else {
    // Diff-scoped mode: default CI/pre-push path
    const diffBase = DEFAULT_DIFF_BASE;
    const added = getAddedLines(diffBase);
    if (added !== null) {
      content = added;
      modeLabel = `diff-scoped (added lines vs ${diffBase})`;
    } else {
      // Diff base unavailable (e.g. CI shallow checkout without `origin/main`,
      // or not a git repo). A DIFF-SCOPED gate must NOT fall back to whole-file
      // here: doing so blocks every PR on PRE-EXISTING stale blocks it never
      // introduced (the fail-closed bug that deadlocked the PR pipeline). Fail
      // OPEN — there are no determinable "added" lines, so there is nothing to
      // reject. Whole-file enforcement remains available via the explicit-path
      // arg (post-sweep verification) and the local pre-push hook (full clone).
      content = "";
      modeLabel = `diff-unavailable — fail-open (base ${diffBase} not reachable)`;
    }
  }

  const result = checkNoDeliveredRetainedBlocks(content);
  if (result.ok) {
    process.stdout.write(
      `check-no-delivered-retained-blocks: ok (0 stale retained blocks introduced) [${modeLabel}]\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `check-no-delivered-retained-blocks: ${result.violations.length} stale retained block(s) introduced [${modeLabel}]:\n`,
  );
  for (const v of result.violations) {
    process.stderr.write(`  line ${v.line}: ${v.text}\n`);
  }
  process.stderr.write(
    "\nFix: remove or update the stale **Blocked**: field. A task whose only blocker\n" +
      'is "test files freeform-cite this id" can be swept by `sweep-stale-delivered-task-blocks`.\n' +
      "If the task is genuinely delivered, delete the entire block from TASKS.md.\n",
  );
  process.exit(1);
}
