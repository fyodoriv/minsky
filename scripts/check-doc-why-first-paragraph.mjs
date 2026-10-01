#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-doc-why-first-paragraph-every-cardinal-md (PR #911) -->
//
// check-doc-why-first-paragraph — every cardinal doc opens with a "why"
// paragraph. Per AGENTS.md §"Documentation rules":
//
//   Every doc starts with one paragraph answering "why does this file exist?"
//
// Heuristic: extract the first non-frontmatter, non-heading paragraph (or
// first three for grace) and verify it matches a why-phrase regex set.
//
// Anchors: AGENTS.md §"Documentation rules"; vision rule #10; the
// reader-priority-docs skill (`.claude/skills/reader-priority-docs/`).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Cardinal docs whose first non-heading paragraph must contain a
 * why-phrase. Paths are repo-root-relative.
 *
 * @type {readonly string[]}
 */
export const CARDINAL_DOCS = Object.freeze([
  "vision.md",
  "AGENTS.md",
  "TASKS.md",
  "README.md",
  "MILESTONES.md",
  "CONTRIBUTING.md",
  "INSTALL.md",
  "docs/ARCHITECTURE.md",
  "docs/DEPRECATED.md",
]);

/**
 * Why-phrase regex set. ANY match in the first three non-heading paragraphs
 * counts as compliant.
 *
 * @type {readonly RegExp[]}
 */
export const WHY_PHRASE_PATTERNS = Object.freeze([
  /\bthis (?:file|doc|document) (?:exists|is|describes|explains|defines|covers|provides)\b/i,
  /\bthe (?:canonical|definitive|authoritative) (?:runbook|spec|guide|index|list)\b/i,
  /\b(?:overview|purpose|why|what)\s+of\s+(?:this|the)\b/i,
  /^>\s/, // a leading blockquote often carries the "why does this exist" line
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {(p: string) => boolean} [fileExists]
 * @property {(p: string) => string} [readText]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkDocWhyFirstParagraph(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const fileExists = opts.fileExists ?? ((p) => existsSync(p));
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  /** @type {string[]} */
  const violations = [];

  for (const relPath of CARDINAL_DOCS) {
    const full = `${repoRoot}/${relPath}`;
    if (!fileExists(full)) continue; // optional doc — not all repos have all files
    const text = readText(full);
    if (!hasWhyParagraph(text)) {
      violations.push(
        `${relPath}: first non-heading paragraph doesn't contain a why-phrase (AGENTS.md §"Documentation rules"). Add an opening line that answers "why does this file exist?" — e.g. "This file is the runbook for…"`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasWhyParagraph(text) {
  const paras = extractFirstParagraphs(text, 3);
  return paras.some((p) => WHY_PHRASE_PATTERNS.some((re) => re.test(p)));
}

/**
 * Extract the first N "content" paragraphs from a markdown file, skipping
 * YAML frontmatter and heading lines.
 *
 * @param {string} text
 * @param {number} n
 * @returns {string[]}
 */
function extractFirstParagraphs(text, n) {
  const stripped = stripFrontmatter(text);
  /** @type {string[]} */
  const paras = [];
  const state = { buf: /** @type {string[]} */ ([]) };
  for (const line of stripped.split("\n")) {
    if (processLineForParagraph(line, paras, state, n)) break;
  }
  if (state.buf.length > 0 && paras.length < n) {
    paras.push(state.buf.join("\n"));
  }
  return paras;
}

/**
 * Single-line processor: appends to buf, or flushes buf into paras on a
 * boundary. Returns true when the n-paragraph budget is reached and the
 * outer loop should stop.
 *
 * @param {string} line
 * @param {string[]} paras
 * @param {{ buf: string[] }} state
 * @param {number} n
 * @returns {boolean}  stop?
 */
function processLineForParagraph(line, paras, state, n) {
  if (!isParagraphBoundary(line)) {
    state.buf.push(line);
    return false;
  }
  if (flushBuf(paras, state.buf)) {
    state.buf = [];
    return paras.length >= n;
  }
  return false;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isParagraphBoundary(line) {
  return line.trim().length === 0 || /^#{1,6}\s/.test(line);
}

/**
 * @param {string[]} paras
 * @param {string[]} buf
 * @returns {boolean}  true if a paragraph was pushed
 */
function flushBuf(paras, buf) {
  if (buf.length === 0) return false;
  paras.push(buf.join("\n"));
  return true;
}

/**
 * Strip YAML frontmatter (`---\n...\n---`) if present at the top of the file.
 *
 * @param {string} text
 * @returns {string}
 */
function stripFrontmatter(text) {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkDocWhyFirstParagraph();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-doc-why-first-paragraph: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
