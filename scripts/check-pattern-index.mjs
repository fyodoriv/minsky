#!/usr/bin/env node
// @ts-check
// Rule #8 ("pattern conformance — every artifact maps to a published
// pattern; deviations are declared") deterministic CI lint.
//
// For every newly-added top-level artifact on the PR branch, require a
// corresponding row in `vision.md` § "Pattern conformance index" that
// mentions the file path (or basename). Eligible paths are:
//
//   novel/**                  — new package files (top-level artefacts)
//   <root>/*.md               — root-level markdown (vision.md, AGENTS.md, …)
//   setup.sh                  — bootstrap entrypoint
//   distribution/**           — supervisor / packaging artefacts
//   .github/workflows/**      — CI workflows
//
// Test files (`*.test.ts`, `*.test.mjs`), fixture files (`*.fixture.ts`),
// and node_modules paths are skipped. Modifications (status M / D / R) are
// skipped — only newly-added (status A) files trigger the check, mirroring
// the rule-1 / rule-3 / rule-4 grandfathering precedent.
//
// Opt-out: a comment `<!-- pattern: not-applicable — <reason> -->` (≥3 char
// reason after the em-dash; ASCII `--` also accepted) within the first
// ~20 lines of the new file. Use this for files that are tooling artefacts
// without their own pattern (e.g., generated lockfiles touched by hand —
// not expected to be common).
//
// DIFF-BASED. Compares HEAD against `origin/main` (override with
// `--diff-base=<ref>` or env `PATTERN_INDEX_DIFF_BASE`).
//
// Pattern: deterministic gate over a PR diff (rule #10).
// Source: rule #8 (vision.md § "Pattern conformance"); rule #10
//   (deterministic enforcement); Beck, *Extreme Programming Explained*,
//   1999 (CI as the constraint enforcer); Alexander et al., *A Pattern
//   Language*, 1977 (catalogue indexed by artefact).
// Conformance: full — pure function over the diff, no LLM in the chain.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// `<!-- pattern: not-applicable — <reason> -->` (or ASCII `--`).
// Reason ≥3 non-whitespace chars after the dash run.
const OPT_OUT_RE = /<!--\s*pattern:\s*not-applicable\s*(?:—|--)\s*([^\n]+?)\s*-->/i;

const HEAD_LINES_FOR_OPT_OUT = 20;

/**
 * @typedef {object} ChangedFile
 * @property {string} path     POSIX, repo-relative
 * @property {string} status   git diff-status letter ("A", "M", "D", "R…")
 */

/**
 * @typedef {object} Violation
 * @property {string} path
 * @property {string} reason
 */

/**
 * @typedef {object} CheckInput
 * @property {readonly ChangedFile[]} changedFiles
 * @property {string} visionMdContent
 * @property {ReadonlyMap<string, string>} optOuts   map from path → reason
 */

/**
 * @typedef {object} CheckResult
 * @property {Violation[]} violations
 */

/**
 * Pure function. See module header for semantics.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkPatternIndex({ changedFiles, visionMdContent, optOuts }) {
  /** @type {Violation[]} */
  const violations = [];
  const indexBody = extractIndexSection(visionMdContent);
  for (const f of changedFiles) {
    if (!isEligibleAddition(f)) continue;
    if (optOuts.has(f.path)) continue;
    if (indexMentions(indexBody, f.path)) continue;
    violations.push({
      path: f.path,
      reason: `${f.path} is a new top-level artefact but no row in vision.md § "Pattern conformance index" mentions it. Add a row (path + pattern + literature source + conformance level), or add \`<!-- pattern: not-applicable — <reason> -->\` to the file.`,
    });
  }
  return { violations };
}

/**
 * @param {ChangedFile} f
 * @returns {boolean}
 */
function isEligibleAddition(f) {
  if (f.status !== "A") return false;
  return isEligiblePath(f.path);
}

/**
 * Pure path-shape check; exposed for the CLI's opt-out scan (we only read
 * the first lines of files we'd otherwise check).
 *
 * @param {string} p
 * @returns {boolean}
 */
export function isEligiblePath(p) {
  if (p.length === 0) return false;
  if (p.includes("node_modules/")) return false;
  if (isTestOrFixture(p)) return false;
  if (p.startsWith("novel/")) return true;
  if (p.startsWith("distribution/")) return true;
  if (p.startsWith(".github/workflows/")) return true;
  if (p === "setup.sh") return true;
  if (isRootMarkdown(p)) return true;
  return false;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isTestOrFixture(p) {
  if (p.endsWith(".test.ts")) return true;
  if (p.endsWith(".test.mjs")) return true;
  if (p.endsWith(".test.js")) return true;
  if (p.endsWith(".fixture.ts")) return true;
  if (p.endsWith(".fixture.mjs")) return true;
  if (p.includes("/__fixtures__/")) return true;
  if (p.includes("/fixtures/")) return true;
  return false;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isRootMarkdown(p) {
  if (!p.endsWith(".md")) return false;
  return !p.includes("/");
}

/**
 * Extract the body of the "Pattern conformance index" section from
 * vision.md. The section runs from its `## ` heading to the next `## `
 * heading (or end-of-file). Returns the raw section text; if the heading
 * isn't found, returns the full input (lenient — better to false-allow
 * than false-deny if vision.md is reformatted).
 *
 * @param {string} md
 * @returns {string}
 */
function extractIndexSection(md) {
  const re = /^##\s+Pattern conformance index\s*$/m;
  const start = md.search(re);
  if (start === -1) return md;
  const after = md.slice(start);
  const nextHeadingIdx = after.search(/\n##\s+\S/);
  if (nextHeadingIdx === -1) return after;
  return after.slice(0, nextHeadingIdx);
}

/**
 * Heuristic: a path is "mentioned" by the index if either the full path
 * or its basename appears as a literal substring in the section body.
 * Whole-path beats basename for new-package additions
 * (`novel/<pkg>/foo.ts` matches a row like `… novel/<pkg>/ … `); basename
 * is the fallback for cases where rows cite filenames only.
 *
 * @param {string} indexBody
 * @param {string} path
 * @returns {boolean}
 */
function indexMentions(indexBody, path) {
  if (indexBody.includes(path)) return true;
  // Package-level fallback: `novel/<pkg>/...` matches if the index mentions
  // `novel/<pkg>` or `novel/<pkg>/`.
  const pkgPath = packagePathOf(path);
  if (pkgPath !== null && indexBody.includes(pkgPath)) return true;
  const base = basename(path);
  if (base.length > 0 && indexBody.includes(base)) return true;
  return false;
}

/**
 * @param {string} p
 * @returns {string | null}
 */
function packagePathOf(p) {
  if (!p.startsWith("novel/")) return null;
  const NESTED = ["adapters", "bridges"];
  const parts = p.split("/");
  if (parts.length >= 3 && parts[1] !== undefined && NESTED.includes(parts[1])) {
    return parts.slice(0, 3).join("/");
  }
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return null;
}

/**
 * Extract the opt-out reason (if any) from the first N lines of file text.
 * Returns the trimmed reason on match, or `null`.
 *
 * @param {string} fileText
 * @returns {string | null}
 */
export function extractOptOutReason(fileText) {
  const head = fileText.split("\n").slice(0, HEAD_LINES_FOR_OPT_OUT).join("\n");
  const m = OPT_OUT_RE.exec(head);
  if (m === null) return null;
  const reason = (m[1] ?? "").trim();
  if (reason.length < 3) return null;
  return reason;
}

// CLI ------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string, repo: string }}
 */
function parseArgs(argv) {
  let diffBase = process.env["PATTERN_INDEX_DIFF_BASE"] ?? "origin/main";
  let repo = REPO_ROOT;
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m === null) continue;
    if (m[1] === "diff-base") diffBase = m[2] ?? diffBase;
    else if (m[1] === "repo") repo = m[2] ?? repo;
  }
  return { diffBase, repo };
}

/**
 * @param {string} diffBase
 * @param {string} repo
 * @returns {ChangedFile[]}
 */
function getChangedFiles(diffBase, repo) {
  const out = execFileSync("git", ["diff", "--name-status", `${diffBase}...HEAD`], {
    cwd: repo,
    encoding: "utf8",
  });
  /** @type {ChangedFile[]} */
  const result = [];
  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const tabIdx = line.indexOf("\t");
    if (tabIdx === -1) continue;
    const status = line.slice(0, tabIdx);
    // For renames (R100, R75, …), git emits two paths separated by tab.
    // We treat renames as Modified, not Added.
    const rest = line.slice(tabIdx + 1);
    const path = rest.split("\t")[1] ?? rest;
    result.push({ status: status[0] ?? status, path });
  }
  return result;
}

/**
 * @param {string} repo
 * @param {readonly ChangedFile[]} changedFiles
 * @returns {Map<string, string>}
 */
function collectOptOuts(repo, changedFiles) {
  /** @type {Map<string, string>} */
  const optOuts = new Map();
  for (const f of changedFiles) {
    if (f.status !== "A") continue;
    if (!isEligiblePath(f.path)) continue;
    const text = readSafe(repo, f.path);
    if (text === null) continue;
    const reason = extractOptOutReason(text);
    if (reason !== null) optOuts.set(f.path, reason);
  }
  return optOuts;
}

/**
 * @param {string} repo
 * @param {string} relPath
 * @returns {string | null}
 */
function readSafe(repo, relPath) {
  try {
    return readFileSync(resolve(repo, relPath), "utf8");
  } catch {
    return null;
  }
}

function main() {
  const { diffBase, repo } = parseArgs(process.argv.slice(2));

  /** @type {ChangedFile[]} */
  let changedFiles;
  try {
    changedFiles = getChangedFiles(diffBase, repo);
  } catch (e) {
    process.stderr.write(
      `pattern-index lint cannot compute diff: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
    return;
  }

  const visionMdContent = readSafe(repo, "vision.md") ?? "";
  if (visionMdContent.length === 0) {
    process.stderr.write("pattern-index lint cannot read vision.md\n");
    process.exit(2);
    return;
  }

  const optOuts = collectOptOuts(repo, changedFiles);

  const { violations } = checkPatternIndex({ changedFiles, visionMdContent, optOuts });

  if (violations.length === 0) {
    process.stdout.write(
      "pattern-index ok: every newly-added top-level artefact is mentioned in vision.md or has an opt-out comment.\n",
    );
    process.exit(0);
    return;
  }

  process.stderr.write(
    'pattern-index: rule #8 violation — new top-level artefact(s) without a row in vision.md § "Pattern conformance index":\n',
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.path} — ${v.reason}\n`);
  }
  process.stderr.write(
    '\nFix: add a row to vision.md § "Pattern conformance index" citing path + pattern + literature source + conformance level, OR add the comment `<!-- pattern: not-applicable — <reason> -->` (≥3-char reason) to the file.\n',
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-pattern-index.mjs") === true;
if (invokedDirectly) main();
