#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved security-privacy-priority-substrate -->
//
// Rule #13 drift gate: for each novel/*/README.md that contains a
// "## Threat model" section, verifies that the section uses STRIDE-shaped
// methodology and has ≥5 non-empty content lines.
//
// Files without a threat model section are skipped (the section ships in
// slice 7 of `security-privacy-priority-substrate`). Once a section exists,
// this gate ensures it stays well-formed.
//
// Acceptance criterion #5 of `security-privacy-priority-substrate` (drift
// gate — not the section-presence gate, which is slice 7's job).
//
// Pattern: deterministic CI gate over static files (rule #10).
// Source: vision.md § 13 (Security & privacy — item 7, threat model per
//   novel package); Shostack, *Threat Modeling: Designing for Security*,
//   Wiley, 2014 (STRIDE methodology); rule #10 (deterministic enforcement).
// Conformance: full — pure function over file content; no LLM in chain.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** STRIDE keywords — at least one must appear in the threat model section. */
export const STRIDE_KEYWORDS = Object.freeze([
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information Disclosure",
  "Denial of Service",
  "Elevation of Privilege",
  "STRIDE",
]);

/** Minimum non-empty lines required in the threat model section body. */
export const MIN_CONTENT_LINES = 5;

/**
 * @typedef {object} ThreatModelResult
 * @property {string}  readmePath   absolute path to the README
 * @property {boolean} sectionFound section "## Threat model" exists
 * @property {boolean} strideOk     at least one STRIDE keyword found
 * @property {boolean} lengthOk     ≥5 non-empty lines in body
 * @property {number}  contentLines count of non-empty lines in body
 */

/**
 * Extract the content of a "## Threat model" (case-insensitive) section
 * from a README string. Returns null if no such section exists.
 *
 * @param {string} readmeContent
 * @returns {string | null}
 */
export function extractThreatModelSection(readmeContent) {
  const sectionRe = /^##\s+Threat\s+model\s*$/im;
  const match = sectionRe.exec(readmeContent);
  if (match === null) return null;

  const afterStart = readmeContent.slice(match.index + match[0].length);
  // Next ## heading ends the section.
  const nextHeading = /^##\s/m.exec(afterStart);
  const body = nextHeading === null ? afterStart : afterStart.slice(0, nextHeading.index);
  return body;
}

/**
 * Pure function. Validates a single README file's threat model section.
 *
 * @param {string} readmePath   absolute path (used only for output)
 * @param {string} readmeContent
 * @param {readonly string[]} [strideKeywords]
 * @param {number} [minLines]
 * @returns {ThreatModelResult}
 */
export function checkReadme(
  readmePath,
  readmeContent,
  strideKeywords = STRIDE_KEYWORDS,
  minLines = MIN_CONTENT_LINES,
) {
  const body = extractThreatModelSection(readmeContent);
  if (body === null) {
    return {
      readmePath,
      sectionFound: false,
      strideOk: false,
      lengthOk: false,
      contentLines: 0,
    };
  }

  const strideOk = strideKeywords.some((kw) => body.includes(kw));
  const contentLines = body.split("\n").filter((line) => line.trim().length > 0).length;
  const lengthOk = contentLines >= minLines;

  return { readmePath, sectionFound: true, strideOk, lengthOk, contentLines };
}

/** Directories that are not novel packages and should be skipped during sub-scan. */
const SKIP_SUBDIRS = new Set(["node_modules", "dist", "src", ".turbo", ".git", "test", "tests"]);

/**
 * Read and validate README.md at the given path if it exists; otherwise return [].
 *
 * @param {string} readmePath
 * @returns {ThreatModelResult[]}
 */
function readIfExists(readmePath) {
  if (!existsSync(readmePath)) return [];
  return [checkReadme(readmePath, readFileSync(readmePath, "utf8"))];
}

/**
 * Enumerate one level of sub-packages inside a top-level novel package directory
 * (e.g. novel/adapters/<sub>/README.md) and run checkReadme on each found README.
 *
 * @param {string} pkgDir
 * @returns {ThreatModelResult[]}
 */
function checkSubPackages(pkgDir) {
  return readdirSync(pkgDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_SUBDIRS.has(e.name))
    .flatMap((sub) => readIfExists(join(pkgDir, sub.name, "README.md")));
}

/**
 * Enumerate novel/<pkg>/README.md files (and one level of sub-packages, e.g.
 * novel/adapters/<sub>/README.md) and run checkReadme on each.
 *
 * @param {string} repoRoot
 * @returns {ThreatModelResult[]}
 */
export function checkAllNovelReadmes(repoRoot) {
  const novelDir = join(repoRoot, "novel");
  if (!existsSync(novelDir)) return [];

  return readdirSync(novelDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      const pkgDir = join(novelDir, e.name);
      return [...readIfExists(join(pkgDir, "README.md")), ...checkSubPackages(pkgDir)];
    });
}

// --------------------------------------------------------------- CLI -------

function main() {
  const results = checkAllNovelReadmes(REPO_ROOT);

  const withSection = results.filter((r) => r.sectionFound);
  const failures = withSection.filter((r) => !r.strideOk || !r.lengthOk);

  if (withSection.length === 0) {
    // No threat model sections exist yet — slice 7 ships them.
    process.stdout.write(
      "check-threat-model-section: no threat model sections found in novel/*/README.md — " +
        "slice 7 of security-privacy-priority-substrate ships them\n",
    );
    process.exit(0);
  }

  if (failures.length === 0) {
    process.stdout.write(
      `check-threat-model-section: ${withSection.length} threat model section(s) validated\n`,
    );
    process.exit(0);
  }

  for (const r of failures) {
    if (!r.strideOk) {
      process.stderr.write(
        `FAIL: ${r.readmePath}: ## Threat model section missing STRIDE keyword (Spoofing / Tampering / Repudiation / Information Disclosure / Denial of Service / Elevation of Privilege / STRIDE)\n`,
      );
    }
    if (!r.lengthOk) {
      process.stderr.write(
        `FAIL: ${r.readmePath}: ## Threat model section has only ${r.contentLines} ` +
          `non-empty line(s); minimum is ${MIN_CONTENT_LINES}\n`,
      );
    }
  }
  process.exit(1);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
