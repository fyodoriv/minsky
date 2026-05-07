#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved security-privacy-priority-substrate -->
//
// Rule #13 substrate-cohesion gate: verifies that each of the 6 sibling
// security P0 task blocks in TASKS.md contains `rule #13` in its
// **Anchor**: line.
//
// Acceptance criterion #3 of `security-privacy-priority-substrate`.
//
// Pattern: deterministic CI gate over a static file (rule #10).
// Source: vision.md § 13 (Security & privacy — substrate cohesion);
//   rule #10 (deterministic enforcement); Saltzer & Schroeder 1975
//   (security by design — structural enforcement, not hope).
// Conformance: full — pure function over file content; no LLM in chain.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Canonical IDs of the open sibling security P0 tasks.
 * Shipped tasks are removed from this list once their PR merges so
 * tasks-lint (which requires removal, not check-off) and this gate
 * don't conflict. Shipped: dashboard-localhost-only-by-default.
 */
export const SIBLING_P0_IDS = Object.freeze([
  "secret-scanning-precommit-and-ci",
  "supervisor-sandbox-syscall-restriction",
  "otel-no-pii-in-spans-lint",
  "supply-chain-hardening-lockfile-sbom-slsa",
  "cloud-tier-external-security-audit-gate",
]);

/**
 * @typedef {object} SiblingResult
 * @property {string} id         task ID
 * @property {boolean} found     task block exists in TASKS.md
 * @property {boolean} anchored  Anchor line contains "rule #13"
 */

/**
 * Pure function. Checks TASKS.md content for each sibling ID's Anchor.
 *
 * Strategy: scan the file for each task's ID block, then find the Anchor
 * line within that block, then verify "rule #13" appears there.
 *
 * @param {string} tasksMdContent
 * @param {readonly string[]} [siblingIds]
 * @returns {SiblingResult[]}
 */
export function checkSiblingAnchors(tasksMdContent, siblingIds = SIBLING_P0_IDS) {
  return siblingIds.map((id) => {
    const idPattern = new RegExp(`\\*\\*ID\\*\\*:\\s*${escapeRegex(id)}`, "m");
    const idMatch = idPattern.exec(tasksMdContent);
    if (idMatch === null) {
      return { id, found: false, anchored: false };
    }

    // Extract text from the task block's start to the next task or section.
    // A task block starts with "- [ ]" or "- [x]" lines; the next block
    // starts with another "- [ ]" / "- [x]" at column 0, or a "## " heading.
    const blockStart = tasksMdContent.lastIndexOf("\n- [", idMatch.index);
    const blockStartIdx = blockStart === -1 ? 0 : blockStart + 1;
    const nextBlockMatch = /^(?:- \[|## )/m.exec(
      tasksMdContent.slice(idMatch.index + idMatch[0].length),
    );
    const blockEnd =
      nextBlockMatch === null
        ? tasksMdContent.length
        : idMatch.index + idMatch[0].length + nextBlockMatch.index;

    const block = tasksMdContent.slice(blockStartIdx, blockEnd);

    const anchorLine = block.split("\n").find((line) => /^\s*-\s*\*\*Anchor\*\*:/.test(line));
    const anchored = anchorLine !== undefined && /rule\s*#13/i.test(anchorLine);

    return { id, found: true, anchored };
  });
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --------------------------------------------------------------- CLI -------

function main() {
  const tasksMdPath = resolve(REPO_ROOT, "TASKS.md");
  let tasksMdContent;
  try {
    tasksMdContent = readFileSync(tasksMdPath, "utf8");
  } catch {
    process.stderr.write(`check-rule-13-sibling-anchors: cannot read ${tasksMdPath}\n`);
    process.exit(1);
  }

  const results = checkSiblingAnchors(tasksMdContent);
  let allPass = true;

  for (const r of results) {
    if (!r.found) {
      process.stderr.write(`FAIL: task block for '${r.id}' not found in TASKS.md\n`);
      allPass = false;
    } else if (!r.anchored) {
      process.stderr.write(
        `FAIL: task '${r.id}' Anchor line does not cite 'rule #13' — add rule #13 (vision.md § 13 — security & privacy) to its **Anchor**: line\n`,
      );
      allPass = false;
    }
  }

  if (allPass) {
    process.stdout.write(
      `check-rule-13-sibling-anchors: all ${results.length} sibling P0 tasks cite rule #13\n`,
    );
    process.exit(0);
  } else {
    process.exit(1);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
