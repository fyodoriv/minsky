#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements parent task `security-privacy-priority-substrate` § Acceptance #2 — drift gate for the `## Security & privacy` section in all 6 user stories -->
// Pattern: deterministic gate over `user-stories/00*.md` `## Security & privacy`
// sections — every constitutional user story (001–006) must carry a section
// that engages with `rule #13` by name and has at least 5 non-empty content
// lines. Pins the 6 sections shipped in the substrate slice of
// `security-privacy-priority-substrate` (acceptance criterion #2).
// Source: vision.md rule #13 (security & privacy as #2 priority after
//   performance); TASKS.md `security-privacy-priority-substrate` acceptance
//   criterion #2 ("Security & privacy section in all 6 user stories");
//   rule #10 (deterministic enforcement — drift detection is a CI lint, not a
//   hope). Conformance: full — pure function over user-story text, no I/O in
//   the check itself.
//
// Why this gate exists: the substrate PR added a `## Security & privacy`
// section to all 6 user stories tying each story's local trust boundary,
// secrets, PII, sandbox, and performance-carve-out clauses to vision.md
// rule #13. Without a deterministic pin, a future user-story rewrite could
// silently drop or shrink one of these sections — and rule #13 would lose
// its grip on the user-story surface that operators and contributors read
// first when scoping a change. This lint pins each section's existence,
// minimum substance (≥5 non-empty lines), and explicit `rule #13` citation
// so the link from story → constitution stays mechanical.
//
// Pivot (rule #9): if vision.md's rule numbering changes (e.g., rule #13
// is renumbered or replaced by a dedicated chapter), narrow the matcher to
// the new citation form rather than retire — the requirement is engagement
// with the constitutional security-privacy anchor, not the literal "13".

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * The 6 constitutional user-story files that must carry a `## Security &
 * privacy` section. Hardcoded (not glob-discovered) on purpose: a new
 * `user-stories/00N-*.md` added without a section should surface as a
 * separate, visible PR ratchet (add the file + add it here + add the
 * section), not slip in silently. Same shape as
 * `THREAT_MODEL_README_PATHS` in `check-threat-model-section.mjs`.
 */
export const USER_STORY_PATHS = Object.freeze([
  "user-stories/001-loop-runs-overnight.md",
  "user-stories/002-pause-from-iphone.md",
  "user-stories/003-mape-k-improves-prompts.md",
  "user-stories/004-budget-auto-pause.md",
  "user-stories/005-watch-three-numbers.md",
  "user-stories/006-runner-on-any-repo.md",
]);

const SECTION_HEADER_RE = /^## Security & privacy\s*$/m;
const NEXT_H2_RE = /^## /m;
const RULE_13_RE = /\brule\s*#\s*13\b/i;
const MIN_CONTENT_LINES = 5;

/**
 * Slice the `## Security & privacy` section body out of a user-story file.
 * Returns `null` when no header exists; otherwise the lines between the header
 * and the next `## ` heading (or EOF). Bold/emphasis markers stay intact —
 * callers strip as needed.
 *
 * @param {string} userStoryText
 * @returns {string | null}
 */
export function extractSecuritySection(userStoryText) {
  const match = userStoryText.match(SECTION_HEADER_RE);
  if (match === null || match.index === undefined) return null;
  const after = userStoryText.slice(match.index + match[0].length);
  const nextHeader = after.match(NEXT_H2_RE);
  return nextHeader?.index !== undefined ? after.slice(0, nextHeader.index) : after;
}

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check on a single user-story's text. Asserts:
 *   1. A `## Security & privacy` heading exists (case-sensitive — the canonical form).
 *   2. The section body has ≥ 5 non-empty content lines (guards against a
 *      future rewrite shrinking it to a stub).
 *   3. The section names `rule #13` explicitly (case-insensitive). The link
 *      from story → constitution must be mechanical, not implicit.
 *
 * @param {string} userStoryText
 * @returns {CheckResult}
 */
export function checkSecuritySection(userStoryText) {
  const section = extractSecuritySection(userStoryText);
  if (section === null) {
    return { ok: false, errors: ["missing `## Security & privacy` section"] };
  }
  /** @type {string[]} */
  const errors = [];
  const nonEmptyLines = section.split("\n").filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < MIN_CONTENT_LINES) {
    errors.push(
      `section has ${nonEmptyLines.length} non-empty content lines (minimum ${MIN_CONTENT_LINES}) — risk of stub drift`,
    );
  }
  if (!RULE_13_RE.test(section)) {
    errors.push(
      "section does not cite `rule #13` — acceptance criterion #2 requires explicit constitutional anchor",
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
export function checkAllSecuritySections(contentsByPath, paths = USER_STORY_PATHS) {
  return paths.map((path) => {
    const text = contentsByPath.get(path);
    if (text === undefined) {
      return { path, result: { ok: false, errors: ["file missing on disk"] } };
    }
    return { path, result: checkSecuritySection(text) };
  });
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const rel of USER_STORY_PATHS) {
    try {
      const text = await readFile(resolve(REPO_ROOT, rel), "utf8");
      contents.set(rel, text);
    } catch {
      // Leave the entry unset; checkAll surfaces "file missing on disk".
    }
  }
  const results = checkAllSecuritySections(contents);
  const failures = results.filter((r) => !r.result.ok);
  if (failures.length === 0) {
    process.stdout.write(
      `user-story-security-section ok: ${USER_STORY_PATHS.length} user stories all carry a rule-#13-anchored security & privacy section.\n`,
    );
    return 0;
  }
  process.stderr.write("user-story-security-section violation:\n");
  for (const { path, result } of failures) {
    if (result.ok) continue;
    for (const err of result.errors) {
      process.stderr.write(`  - ${path}: ${err}\n`);
    }
  }
  process.stderr.write(
    [
      "",
      "Per vision.md § 13 and TASKS.md `security-privacy-priority-substrate`",
      "acceptance criterion #2, every user story must carry a `## Security &",
      "privacy` section that cites `rule #13` and has ≥5 non-empty content lines.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-user-story-security-section.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
