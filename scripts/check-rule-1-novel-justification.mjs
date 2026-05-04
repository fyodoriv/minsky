#!/usr/bin/env node
// Rule #1 (don't reinvent the wheel) deterministic CI lint.
//
// For every newly-added top-level directory under `novel/` (excluding
// `novel/adapters/` — adapters belong to rule #2, not rule #1), require either:
//   (a) a row/subsection in `research.md` under a heading matching
//       `(?i)when the existing tools didn['’]t fit` that mentions the package
//       name, OR
//   (b) an opt-out HTML comment in the package README of the form:
//       `<!-- rule-1: <existing-tool-considered> rejected because: <reason> -->`
//
// Anchor: rule #10 (deterministic enforcement); Lampson 1983 ("move the
// constraint to the cheapest possible point").

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OPT_OUT = /<!--\s*rule-1:\s*[^\n]*rejected because:\s*[^\n]*-->/i;
const NOVEL_PATH = /^novel\/([^/]+)\/(.+)$/;
const HEADING_RE = /(?:^|\n)(#{1,6})\s+([^\n]*)/g;
const SECTION_TITLE = /when the existing tools didn['’]t fit/i;

/** @typedef {{ pkg: string, reason: string }} RuleError */
/** @typedef {(pkg: string) => string | null} ReadReadme */
/** @typedef {{ start: number, depth: number, title: string }} Heading */

/**
 * Pure, deterministic check. The CLI wraps this; tests target it directly.
 *
 * @param {object} args
 * @param {string[]} args.added - Newly-added file paths (POSIX, repo-relative).
 * @param {string} args.researchMd - Full text of `research.md`.
 * @param {ReadReadme} args.readReadme - Returns the
 *   README contents for `novel/<pkg>/README.md`, or `null` if absent.
 * @returns {{ errors: RuleError[] }}
 */
export function checkAdditions({ added, researchMd, readReadme }) {
  const candidates = collectCandidates(added);
  /** @type {RuleError[]} */
  const errors = [];
  for (const pkg of [...candidates].sort()) {
    if (isJustified(pkg, researchMd, readReadme)) continue;
    errors.push({ pkg, reason: missingReason(pkg) });
  }
  return { errors };
}

/**
 * @param {string[]} added
 * @returns {Set<string>}
 */
function collectCandidates(added) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const p of added) {
    const m = NOVEL_PATH.exec(p);
    if (!m) continue;
    const name = m[1];
    if (name === undefined) continue;
    // `novel/adapters/<NAME>/...` is governed by rule #2 (dep coverage), not
    // rule #1. Skip the literal `adapters` directory itself.
    if (name === "adapters") continue;
    out.add(name);
  }
  return out;
}

/**
 * @param {string} pkg
 * @param {string} researchMd
 * @param {ReadReadme} readReadme
 * @returns {boolean}
 */
function isJustified(pkg, researchMd, readReadme) {
  if (researchMdMentionsPackage(researchMd, pkg)) return true;
  const readme = readReadme(pkg);
  return readme !== null && OPT_OUT.test(readme);
}

/**
 * @param {string} pkg
 * @returns {string}
 */
function missingReason(pkg) {
  return (
    `novel/${pkg}/ is new but research.md has no entry under a ` +
    `"When the existing tools didn't fit" heading mentioning "${pkg}", ` +
    `and novel/${pkg}/README.md has no rule-1 opt-out comment.`
  );
}

/**
 * True iff `pkg` appears in the body of some section whose heading matches the
 * "When the existing tools didn't fit" pattern (case-insensitive). The section
 * body runs from the matched heading up to the next heading of equal or
 * shallower depth, or end-of-file.
 *
 * @param {string} researchMd
 * @param {string} pkg
 * @returns {boolean}
 */
function researchMdMentionsPackage(researchMd, pkg) {
  const pkgRe = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(pkg)}(?![A-Za-z0-9_-])`);
  const headings = parseHeadings(researchMd);
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h === undefined) continue;
    if (!SECTION_TITLE.test(h.title)) continue;
    const end = sectionEnd(headings, i, researchMd.length);
    if (pkgRe.test(researchMd.slice(h.start, end))) return true;
  }
  return false;
}

/**
 * @param {string} researchMd
 * @returns {Heading[]}
 */
function parseHeadings(researchMd) {
  const re = new RegExp(HEADING_RE.source, "g");
  /** @type {Heading[]} */
  const out = [];
  for (;;) {
    const m = re.exec(researchMd);
    if (m === null) break;
    const hashes = m[1];
    const title = m[2];
    if (hashes === undefined || title === undefined) continue;
    // Heading start = position of the `#` characters (skip a leading newline if
    // the regex matched on `\n`).
    const start = m[0].startsWith("\n") ? m.index + 1 : m.index;
    out.push({ start, depth: hashes.length, title });
  }
  return out;
}

/**
 * @param {Heading[]} headings
 * @param {number} i
 * @param {number} eof
 * @returns {number}
 */
function sectionEnd(headings, i, eof) {
  const head = headings[i];
  if (head === undefined) return eof;
  const depth = head.depth;
  for (let j = i + 1; j < headings.length; j++) {
    const next = headings[j];
    if (next !== undefined && next.depth <= depth) return next.start;
  }
  return eof;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// CLI ------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string, repo: string }}
 */
function parseArgs(argv) {
  const out = { diffBase: "main", repo: process.cwd() };
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    if (key === undefined || value === undefined) continue;
    if (key === "diff-base") out.diffBase = value;
    else if (key === "repo") out.repo = value;
  }
  return out;
}

/**
 * @param {string} diffBase
 * @param {string} repo
 * @returns {string[]}
 */
function getAddedPaths(diffBase, repo) {
  // `--diff-filter=A`: added paths only. `<base>...HEAD`: paths added on HEAD
  // since the merge-base with `<base>`. We surface the git error verbatim so
  // CI shows the cause if `<base>` is unreachable.
  const out = execFileSync(
    "git",
    ["diff", "--diff-filter=A", "--name-only", `${diffBase}...HEAD`],
    { cwd: repo, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * @param {string} p
 * @returns {Promise<string | null>}
 */
async function readFileSafe(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * @param {string} repo
 * @param {string} pkg
 * @returns {string | null}
 */
function readReadmeSync(repo, pkg) {
  try {
    return readFileSync(path.join(repo, "novel", pkg, "README.md"), "utf8");
  } catch {
    return null;
  }
}

function reportSuccess() {
  console.info("rule-1: ok (no unjustified novel additions)");
}

/**
 * @param {RuleError[]} errors
 * @returns {void}
 */
function reportFailure(errors) {
  console.error("rule-1: missing justification for new novel/ packages:");
  for (const e of errors) {
    console.error(`  - ${e.pkg}: ${e.reason}`);
  }
  console.error(
    "\nFix: add a row under a `When the existing tools didn't fit` heading in research.md,\n" +
      "or add `<!-- rule-1: <existing-tool> rejected because: <reason> -->` to the package README.",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const added = getAddedPaths(args.diffBase, args.repo);
  const researchMd = (await readFileSafe(path.join(args.repo, "research.md"))) ?? "";

  const { errors } = checkAdditions({
    added,
    researchMd,
    readReadme: (pkg) => readReadmeSync(args.repo, pkg),
  });

  if (errors.length === 0) {
    reportSuccess();
    process.exit(0);
  }
  reportFailure(errors);
  process.exit(1);
}

// Only run main() when invoked as a script. Tests import the module without
// triggering the CLI.
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err) => {
    console.error(err.stack ?? String(err));
    process.exit(2);
  });
}
