#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over `novel/**/README.md` STRIDE-shaped threat-model
// sections — every constitutional novel package's README must carry a `## Threat
// model` section that engages with STRIDE methodology by name and has at least
// 5 non-empty content lines. Pins the 16 sections shipped in PR #249 (10
// top-level packages) + PR #250 (6 adapter subpackages).
// Source: vision.md rule #13.8 (threat-model section per novel package);
//   TASKS.md `security-privacy-priority-substrate` acceptance criterion #5;
//   rule #10 (deterministic enforcement — drift detection is a CI lint, not a
//   hope); Howard & LeBlanc, *Writing Secure Code*, 2003 (STRIDE shape).
//   Conformance: full — pure function over README text, no I/O in the check.
//
// Why this gate exists: PRs #249 and #250 added STRIDE-shaped threat-model
// sections to all 16 `novel/*/README.md` and `novel/adapters/*/README.md`
// files, satisfying acceptance criterion #5 of `security-privacy-priority-
// substrate`. Without a deterministic pin, a future README rewrite could
// silently shrink, weaken, or drop these sections — and rule #13.8 would
// lose its grip on the package-level documentation surface that operators
// rely on for incident response. This lint pins the section's existence,
// minimum substance (≥5 non-empty lines), and STRIDE-name engagement
// (the methodology must be cited even when a package's STRIDE letters
// don't apply, as in `novel/adapters/types/README.md`).
//
// Pivot (rule #9): if STRIDE is later replaced by a different threat-model
// methodology in vision.md (e.g., LINDDUN for privacy-heavy packages),
// extend the matcher to accept either token rather than retire — the
// requirement is engagement with a named threat-model methodology, not
// STRIDE specifically.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The 16 constitutional novel-package READMEs that must carry a STRIDE-shaped
 * `## Threat model` section. Hardcoded (not glob-discovered) on purpose: a
 * new `novel/<name>/` package added without a threat-model section should
 * surface as a separate, visible PR ratchet (add the package + add it here +
 * add the section), not slip in silently.
 */
export const THREAT_MODEL_README_PATHS = Object.freeze([
  "novel/bridges/README.md",
  "novel/budget-guard/README.md",
  "novel/cross-repo-runner/README.md",
  "novel/dashboard-web/README.md",
  "novel/experiment-record/README.md",
  "novel/handoff-spec/README.md",
  "novel/mape-k-loop/README.md",
  "novel/sidecar-bootstrap/README.md",
  "novel/spec-monitor/README.md",
  "novel/tick-loop/README.md",
  "novel/adapters/notifier/README.md",
  "novel/adapters/observability/README.md",
  "novel/adapters/persona-spawner/README.md",
  "novel/adapters/prompt-optimizer/README.md",
  "novel/adapters/token-monitor/README.md",
  "novel/adapters/types/README.md",
]);

const SECTION_HEADER_RE = /^## Threat model\s*$/m;
const NEXT_H2_RE = /^## /m;
const STRIDE_RE = /\bSTRIDE\b/i;
const MIN_CONTENT_LINES = 5;

/**
 * Slice the `## Threat model` section body out of a README. Returns `null`
 * when no header exists; otherwise the lines between the header and the next
 * `## ` heading (or EOF). Bold/emphasis markers stay intact — callers strip
 * as needed.
 *
 * @param {string} readmeText
 * @returns {string | null}
 */
export function extractThreatModelSection(readmeText) {
  const match = readmeText.match(SECTION_HEADER_RE);
  if (match === null || match.index === undefined) return null;
  const after = readmeText.slice(match.index + match[0].length);
  const nextHeader = after.match(NEXT_H2_RE);
  return nextHeader?.index !== undefined ? after.slice(0, nextHeader.index) : after;
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check on a single README's text. Asserts:
 *   1. A `## Threat model` heading exists (case-sensitive — the canonical form).
 *   2. The section body has ≥ 5 non-empty content lines (guards against
 *      a future rewrite shrinking it to a stub).
 *   3. The section names STRIDE explicitly (case-insensitive). Even when a
 *      package's STRIDE letters don't apply (e.g., the leaf-only `types`
 *      adapter), the methodology must be cited so future readers see the
 *      author engaged with it rather than skipped it.
 *
 * @param {string} readmeText
 * @returns {CheckResult}
 */
export function checkThreatModelSection(readmeText) {
  const section = extractThreatModelSection(readmeText);
  if (section === null) {
    return { ok: false, errors: ["missing `## Threat model` section"] };
  }
  /** @type {string[]} */
  const errors = [];
  const nonEmptyLines = section.split("\n").filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < MIN_CONTENT_LINES) {
    errors.push(
      `section has ${nonEmptyLines.length} non-empty content lines (minimum ${MIN_CONTENT_LINES}) — risk of stub drift`,
    );
  }
  if (!STRIDE_RE.test(section)) {
    errors.push(
      "section does not name `STRIDE` — rule #13.8 requires explicit methodology engagement",
    );
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @typedef {{ path: string, result: CheckResult }} PathResult
 */

/**
 * Aggregate check across all hardcoded paths. Pure: takes a `Map<path,
 * content>` and returns a list of `{ path, result }` entries.
 *
 * @param {ReadonlyMap<string, string>} contentsByPath
 * @param {readonly string[]} [paths]
 * @returns {PathResult[]}
 */
export function checkAllThreatModelSections(contentsByPath, paths = THREAT_MODEL_README_PATHS) {
  return paths.map((path) => {
    const text = contentsByPath.get(path);
    if (text === undefined) {
      return { path, result: { ok: false, errors: ["file missing on disk"] } };
    }
    return { path, result: checkThreatModelSection(text) };
  });
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const rel of THREAT_MODEL_README_PATHS) {
    try {
      const text = await readFile(resolve(REPO_ROOT, rel), "utf8");
      contents.set(rel, text);
    } catch {
      // Leave the entry unset; checkAll surfaces "file missing on disk".
    }
  }
  const results = checkAllThreatModelSections(contents);
  const failures = results.filter((r) => !r.result.ok);
  if (failures.length === 0) {
    process.stdout.write(
      `threat-model-section ok: ${THREAT_MODEL_README_PATHS.length} novel/* READMEs all carry a STRIDE-shaped threat-model section.\n`,
    );
    return 0;
  }
  process.stderr.write("threat-model-section violation:\n");
  for (const { path, result } of failures) {
    if (result.ok) continue;
    for (const err of result.errors) {
      process.stderr.write(`  - ${path}: ${err}\n`);
    }
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13.8 and TASKS.md `security-privacy-priority-substrate`",
      "acceptance criterion #5, every novel package's README must carry a",
      "STRIDE-shaped `## Threat model` section with ≥5 non-empty content lines.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-threat-model-section.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
