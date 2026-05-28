#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved docs-discipline per docs-frame-coherence-lint -->
//
// check-docs-frame-coherence — deterministic lint for the
// reader-orientation doc frame defined in `docs/PRACTICES.md §
// Unified reader-orientation doc frame` (PR #685, operator
// directive 2026-05-21).
//
// CONTRACT: every doc in the allowlist must open with:
//   1. an H1 followed by a one-line `>` blockquote tagline,
//   2. a `## What this is` or `## What this file is` section, and
//   3. a `## What this is not` or `## What this file is not` section.
//
// EXIT CODES:
//   0 — every allowlisted doc conforms
//   1 — at least one allowlisted doc violates the frame; stderr
//       lists per-file diff (which beat is missing).
//
// USAGE:
//   node scripts/check-docs-frame-coherence.mjs
//   node scripts/check-docs-frame-coherence.mjs --json  (machine-readable)
//
// ALLOWLIST: only files in DOCS_FRAME_ALLOWLIST below are guarded.
// A doc not in the allowlist is silently passed. New reader-
// orientation docs added after 2026-05-19 (e.g. `docs/SECURITY.md`)
// SHOULD be added to the allowlist as part of their introducing PR.
//
// PENDING-RESTORE: the original docs/PRACTICES.md § Unified reader-
// orientation doc frame block named 18 docs. As of 2026-05-28, the
// frame is present on AGENTS.md, INSTALL.md, and docs/PRACTICES.md;
// many others have drifted (README.md rewritten in PR #948; vision.md,
// MILESTONES.md, competitors/*.md never updated; ARCHITECTURE.md +
// DEPRECATED.md + research.md were retired during Path-A). The lint
// ships with only the surviving conformant docs in the live allowlist
// + a `PENDING_RESTORE` list documenting which docs need the frame
// re-applied. Follow-up task: `docs-frame-restore-across-allowlist`.
//
// ANCHORS: docs/PRACTICES.md § "Unified reader-orientation doc frame";
// PR #685 (the wholesale application); rule #10 (deterministic
// enforcement — this lint is the gate the rule asks for).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Live allowlist — docs the lint actively guards. Each entry MUST
 * conform to the 3-beat frame. Adding a doc here is a load-bearing
 * commit — the doc must already conform when the entry lands.
 *
 * @type {readonly string[]}
 */
export const DOCS_FRAME_ALLOWLIST = Object.freeze(["AGENTS.md", "INSTALL.md", "docs/PRACTICES.md"]);

/**
 * Docs that BELONG in the allowlist per `docs/PRACTICES.md` but have
 * drifted from the frame. Tracked so the next "restore-the-frame"
 * sweep can move each into the live allowlist without re-discovering
 * the canonical list.
 *
 * Not exported — purely a documentation artefact inside this file.
 */
const PENDING_RESTORE = Object.freeze([
  "README.md", // rewritten PR #948 (5-min-install-guide cut)
  "MILESTONES.md", // never had the frame
  "vision.md", // never had the frame
  // competitors/*.md — 16 files, none have the frame
]);
void PENDING_RESTORE;

/**
 * @typedef {object} FrameViolation
 * @property {string} file
 * @property {string[]} missing      list of missing beats (human-readable)
 */

/**
 * Check whether `content` opens with the H1-then-blockquote shape.
 * Allows blank lines between the H1 and the blockquote.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function hasH1Tagline(content) {
  return /^# [^\n]+\n+>\s+\S+/m.test(content);
}

/**
 * Check whether `content` has a `## What this is` or
 * `## What this file is` heading (NOT followed by `not`).
 *
 * @param {string} content
 * @returns {boolean}
 */
export function hasWhatThisIs(content) {
  return /^## What this (file )?is\b(?! not)/m.test(content);
}

/**
 * Check whether `content` has a `## What this is not` or
 * `## What this file is not` heading.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function hasWhatThisIsNot(content) {
  return /^## What this (file )?is not\b/m.test(content);
}

/**
 * Run the 3-beat check against one file. Returns the list of missing
 * beats (empty when conformant).
 *
 * @param {string} content
 * @returns {string[]}
 */
export function checkContent(content) {
  const missing = [];
  if (!hasH1Tagline(content)) missing.push("H1 + `>` blockquote tagline");
  if (!hasWhatThisIs(content)) missing.push("`## What this is` (or `## What this file is`)");
  if (!hasWhatThisIsNot(content)) {
    missing.push("`## What this is not` (or `## What this file is not`)");
  }
  return missing;
}

/**
 * Walk the allowlist + collect violations. Pure function over an
 * I/O reader so the test suite can swap a memory backend.
 *
 * @param {readonly string[]} allowlist
 * @param {(relPath: string) => string | null} read   returns null when missing
 * @returns {FrameViolation[]}
 */
export function checkAllowlist(allowlist, read) {
  /** @type {FrameViolation[]} */
  const violations = [];
  for (const relPath of allowlist) {
    const content = read(relPath);
    if (content === null) {
      violations.push({ file: relPath, missing: ["FILE MISSING ON DISK"] });
      continue;
    }
    const missing = checkContent(content);
    if (missing.length > 0) violations.push({ file: relPath, missing });
  }
  return violations;
}

// ── CLI ─────────────────────────────────────────────────────────────

/**
 * @param {string} relPath
 * @returns {string | null}
 */
function readFromRepo(relPath) {
  const abs = resolve(REPO_ROOT, relPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function isInvokedAsScript() {
  if (process.argv[1] === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
  } catch {
    return false;
  }
}

function runCli() {
  const wantJson = process.argv.includes("--json");
  const violations = checkAllowlist(DOCS_FRAME_ALLOWLIST, readFromRepo);
  if (wantJson) {
    process.stdout.write(`${JSON.stringify(violations, null, 2)}\n`);
    process.exit(violations.length === 0 ? 0 : 1);
  }
  if (violations.length === 0) {
    process.stdout.write(
      `docs-frame-coherence: OK (${DOCS_FRAME_ALLOWLIST.length} doc(s) checked)\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`docs-frame-coherence: FAIL (${violations.length} doc(s) violate):\n\n`);
  for (const v of violations) {
    process.stderr.write(`  - ${v.file}:\n`);
    for (const beat of v.missing) {
      process.stderr.write(`      missing: ${beat}\n`);
    }
  }
  process.stderr.write(
    "\nFix: restore the frame per docs/PRACTICES.md § Unified reader-orientation doc frame.\n",
  );
  process.exit(1);
}

if (isInvokedAsScript()) {
  runCli();
}
