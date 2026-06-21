#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved stale-delivered-block-ci-gate — deterministic CI gate, no novel UX surface -->
// check-no-delivered-retained-blocks — rejects any TASKS.md commit that
// introduces a `**Blocked**:` field containing the substring
// `DELIVERED.*block retained`, preventing re-accumulation of the stale
// citation pattern that `sweep-stale-delivered-task-blocks` cleans up.
//
// Pattern: deterministic gate over TASKS.md (rule #10). Pure grep — no
// LLM, no network, no side effects. Target wall-clock <100ms.
//
// Source: task `stale-delivered-block-ci-gate` (P0, M1); vision.md rule
// #10 (deterministic enforcement); Hunt & Thomas, *The Pragmatic
// Programmer* 1999 Ch. 8 — "Don't Live with Broken Windows": each
// unaddressed stale block raises tolerance for the next; a CI gate is
// the mechanical zero-tolerance policy that closes the accumulation loop.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

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
 * Scan TASKS.md text for stale delivered-retained-block patterns.
 *
 * @param {string} tasksMd
 * @returns {CheckResult}
 */
export function checkNoDeliveredRetainedBlocks(tasksMd) {
  const lines = tasksMd.split("\n");
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

// --------------------------------------------------------------- CLI -------

if (import.meta.url === `file://${process.argv[1]}`) {
  const tasksMdPath = process.argv[2] ?? resolve(REPO_ROOT, "TASKS.md");
  const tasksMd = readFileSync(tasksMdPath, "utf8");
  const result = checkNoDeliveredRetainedBlocks(tasksMd);
  if (result.ok) {
    process.stdout.write("check-no-delivered-retained-blocks: ok (0 stale retained blocks)\n");
    process.exit(0);
  }
  process.stderr.write(
    `check-no-delivered-retained-blocks: ${result.violations.length} stale retained block(s) found in TASKS.md:\n`,
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
