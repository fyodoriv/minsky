#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved scout finding from /next-task session 2026-05-27 — README regrew from 2910 → 11058 bytes since `readme-rewrite-5-min-install-guide` parent shipped its compression slices (PRs #751/#752/#753). Without a byte-budget gate the compression decays. -->
//
// check-readme-byte-budget — fails CI when README.md exceeds the
// declared byte budget. Ratchet model:
//   - HARD_LIMIT (current baseline + small headroom): blocks net growth
//   - TARGET (the parent task's <3KB goal): documented; the lint
//     prints progress vs target on every run so the gap is visible
//
// As compression slices land, the operator (or the next agent picking
// `readme-rewrite-5-min-install-guide`) drops HARD_LIMIT toward TARGET.
// The lint becomes the deterministic enforcer of the prose target
// instead of letting it decay between PRs.
//
// Per AGENTS.md (rule #10 — every constitutional rule is a deterministic
// gate, not a hope) + rule #17 (proactive heal — the regrowth I
// observed becomes the fix). The README target is in the parent task's
// Success criteria; this lint pins it.
//
// Anchors: rule #10 + rule #17; readme-rewrite-5-min-install-guide
// parent's "Success: README is <3KB"; observed regrowth from 2910 →
// 11058 bytes across 2026-05-23 → 2026-05-28.

import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The eventual target — per readme-rewrite-5-min-install-guide parent
 * task Success criterion. Stored as bytes (3 KiB = 3072 bytes).
 *
 * @type {number}
 */
export const README_BYTE_BUDGET_TARGET = 3072;

/**
 * The CURRENT enforced ceiling. Set to current size + small headroom
 * at lint introduction (2026-05-28). Future PRs that compress the
 * README drop this number; future PRs that grow it past this number
 * fail the gate.
 *
 * @type {number}
 */
export const README_BYTE_BUDGET_HARD_LIMIT = 11500;

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {number} actualBytes
 * @property {number} hardLimit
 * @property {number} target
 * @property {string} message
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [readmePath]
 * @property {number} [hardLimit]
 * @property {number} [target]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkReadmeByteBudget(opts = {}) {
  const path = opts.readmePath ?? `${REPO_ROOT}/README.md`;
  const hardLimit = opts.hardLimit ?? README_BYTE_BUDGET_HARD_LIMIT;
  const target = opts.target ?? README_BYTE_BUDGET_TARGET;
  const actualBytes = statSync(path).size;
  const overBy = actualBytes - hardLimit;
  if (actualBytes <= hardLimit) {
    const towardTarget = actualBytes - target;
    return {
      ok: true,
      actualBytes,
      hardLimit,
      target,
      message: `check-readme-byte-budget: ok (${actualBytes} bytes, ${hardLimit - actualBytes} bytes under ceiling, ${towardTarget > 0 ? `${towardTarget} bytes over target ${target}` : `${-towardTarget} bytes under target — drop hard-limit`})`,
    };
  }
  return {
    ok: false,
    actualBytes,
    hardLimit,
    target,
    message: `check-readme-byte-budget: README.md grew ${overBy} bytes past the ceiling (${actualBytes} > ${hardLimit}). Per readme-rewrite-5-min-install-guide, the README target is ${target} bytes (<5min read). Compress the README OR raise the ceiling explicitly with a documented reason.`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkReadmeByteBudget();
  if (result.ok) {
    process.stdout.write(`${result.message}\n`);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(1);
}
