#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-omc-mode-and-persona-tag-gating (PR #911) -->
//
// check-omc-mode-persona-gating — lint that audits TASKS.md task blocks
// against AGENTS.md §"Choosing an OMC mode for a task" + §"Investor /
// growth-hacker personas".
//
// Two checks per task block:
//
// (1) OMC-mode coherence:
//     - Tasks with Tags including `multi-domain` OR `coordination` SHOULD
//       declare `**OMC-Mode**: /team`. (warning if missing — these are
//       multi-tag situations where /autopilot would be wasteful.)
//     - Tasks with Tags including `parallel` OR `refactor` SHOULD declare
//       `**OMC-Mode**: /ultrawork` (or `ulw`).
//     - Tasks with Tags including `relentless` OR `verify-required`
//       SHOULD declare `**OMC-Mode**: /ralph`.
//
// (2) Persona-gate: tasks NOT tagged business/growth/revenue/customer/
//     pricing MUST NOT carry product-manager / product-analyst / analyst
//     persona content (`**Persona**:` declarations or `(@product-...)`
//     claims). Saves tokens + prevents drift.
//
// This lint is ADVISORY in the agent loop (warning, not blocker) until
// the cohort drains — then it becomes a hard gate. Per the rule #10
// ratchet pattern.
//
// Anchors: AGENTS.md §"Choosing an OMC mode" + §"Investor / growth-
// hacker personas"; vision rule #10 (deterministic enforcement).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Tag → expected-mode mapping per AGENTS.md "Choosing an OMC mode" table.
 *
 * @type {ReadonlyArray<{ tags: readonly string[], mode: string }>}
 */
export const OMC_MODE_MAPPING = Object.freeze([
  { tags: ["multi-domain", "coordination"], mode: "/team" },
  { tags: ["parallel", "refactor"], mode: "/ultrawork" },
  { tags: ["relentless", "verify-required"], mode: "/ralph" },
]);

/**
 * Tags that ALLOW investor/growth-hacker personas. Per AGENTS.md
 * §"Investor / growth-hacker personas".
 *
 * @type {ReadonlySet<string>}
 */
export const PERSONA_ALLOWED_TAGS = new Set([
  "business",
  "growth",
  "revenue",
  "customer",
  "pricing",
]);

/**
 * Persona names that are GATED behind PERSONA_ALLOWED_TAGS.
 *
 * @type {ReadonlySet<string>}
 */
export const GATED_PERSONAS = new Set(["product-manager", "product-analyst", "analyst"]);

/**
 * @typedef {object} TaskBlock
 * @property {string} id
 * @property {string} tags
 * @property {string} body
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [tasksMdPath]
 * @property {string} [tasksMdContent]
 * @property {boolean} [strict]    if true, missing OMC-Mode is a violation;
 *                                 if false (default), only persona-gate
 *                                 violations are reported as hard errors
 */

/**
 * Extract task blocks from TASKS.md content.
 *
 * @param {string} src
 * @returns {TaskBlock[]}
 */
export function extractTaskBlocks(src) {
  /** @type {TaskBlock[]} */
  const blocks = [];
  const state = { current: /** @type {TaskBlock | null} */ (null) };
  for (const line of src.split("\n")) {
    processLine(line, blocks, state);
  }
  if (state.current !== null) blocks.push(state.current);
  return blocks;
}

/**
 * @param {string} line
 * @param {TaskBlock[]} blocks
 * @param {{ current: TaskBlock | null }} state
 */
function processLine(line, blocks, state) {
  const headMatch = /^- \[ \] `([^`]+)`/.exec(line);
  if (headMatch !== null && headMatch[1] !== undefined) {
    if (state.current !== null) blocks.push(state.current);
    state.current = { id: headMatch[1], tags: "", body: `${line}\n` };
    return;
  }
  if (state.current === null) return;
  const tagsMatch = /^\s+(?:-\s+)?\*\*Tags\*\*:\s*(.+)$/.exec(line);
  if (tagsMatch !== null && tagsMatch[1] !== undefined) {
    state.current.tags = tagsMatch[1].trim();
  }
  if (line.startsWith("  - ")) {
    state.current.body += `${line}\n`;
    return;
  }
  // Boundary (blank line or non-indented line) — flush current block.
  blocks.push(state.current);
  state.current = null;
}

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkOmcModePersonaGating(opts = {}) {
  const path = opts.tasksMdPath ?? `${REPO_ROOT}/TASKS.md`;
  const src = opts.tasksMdContent ?? readFileSync(path, "utf8");
  const strict = opts.strict ?? false;
  const blocks = extractTaskBlocks(src);
  /** @type {string[]} */
  const violations = [];

  for (const block of blocks) {
    const blockTags = block.tags
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    checkPersonaGate(block, blockTags, violations);
    if (strict) {
      checkOmcModeAlignment(block, blockTags, violations);
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    scannedCount: blocks.length,
  };
}

/**
 * @param {TaskBlock} block
 * @param {string[]} blockTags
 * @param {string[]} violations
 */
function checkPersonaGate(block, blockTags, violations) {
  const hasAllowedTag = blockTags.some((t) => PERSONA_ALLOWED_TAGS.has(t));
  if (hasAllowedTag) return;
  // Scan body for gated persona references.
  for (const persona of GATED_PERSONAS) {
    const reInline = new RegExp(`\\*\\*Persona\\*\\*:[^\\n]*\\b${persona}\\b`, "i");
    const reClaim = new RegExp(`\\(@${persona}\\b`, "i");
    if (reInline.test(block.body) || reClaim.test(block.body)) {
      violations.push(
        `${block.id}: references gated persona "${persona}" but Tags lacks any of ${Array.from(PERSONA_ALLOWED_TAGS).join("/")}. Per AGENTS.md §"Investor / growth-hacker personas" — saves tokens + prevents drift.`,
      );
    }
  }
}

/**
 * @param {TaskBlock} block
 * @param {string[]} blockTags
 * @param {string[]} violations
 */
function checkOmcModeAlignment(block, blockTags, violations) {
  for (const { tags, mode } of OMC_MODE_MAPPING) {
    const matched = tags.find((t) => blockTags.includes(t));
    if (matched === undefined) continue;
    const declRe = /\*\*OMC-Mode\*\*:\s*([^\s\n]+)/;
    const declMatch = declRe.exec(block.body);
    if (declMatch === null || declMatch[1] === undefined) {
      violations.push(
        `${block.id}: tagged "${matched}" but no \`**OMC-Mode**:\` declaration. Per AGENTS.md §"Choosing an OMC mode", expected \`${mode}\`.`,
      );
      return;
    }
    const declValue = declMatch[1];
    if (!declValue.includes(mode.replace("/", ""))) {
      violations.push(
        `${block.id}: tagged "${matched}" → expected \`**OMC-Mode**: ${mode}\` but got \`${declValue}\`. Per AGENTS.md §"Choosing an OMC mode".`,
      );
    }
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const strict = process.argv.includes("--strict");
  const result = checkOmcModePersonaGating({ strict });
  if (result.ok) {
    process.exit(0);
  }
  console.error(
    `check-omc-mode-persona-gating: ${result.violations.length} violation(s) (strict=${strict}):`,
  );
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
