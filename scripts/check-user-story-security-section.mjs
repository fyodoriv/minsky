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
// minimum substance (≥5 non-empty lines), explicit `rule #13` citation,
// and the 5 canonical bold-prefixed bullets that make the section
// substantively engage with the rule's minimum-bar items 1–4 + the
// performance carve-out clause. The bullet pin is the difference between
// "section exists" (today) and "section addresses the rule" (after this
// ratchet) — a section could otherwise degenerate to 5 lines of prose
// citing rule #13 with no concrete trust-boundary / secrets / PII /
// sandbox / carve-out coverage.
//
// Pivot (rule #9): if vision.md's rule numbering changes (e.g., rule #13
// is renumbered or replaced by a dedicated chapter), narrow the matcher to
// the new citation form rather than retire — the requirement is engagement
// with the constitutional security-privacy anchor, not the literal "13".
// If the canonical bullet set itself shifts (e.g., a 6th minimum-bar item
// gains a corresponding bullet), extend `REQUIRED_BULLETS` in the same PR
// that adds the bullet — never one without the other.

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
 * The 5 canonical bold-prefixed bullets every user-story Security & privacy
 * section must carry. Maps 1:1 to rule #13's minimum-bar items 1–4 +
 * performance-first carve-out clause:
 *   - **Trust boundary** → STRIDE shape (rule #13.8 sibling for stories)
 *   - **Secrets** → minimum-bar item #1 (`secret-scanning-precommit-and-ci`)
 *   - **PII** → minimum-bar item #2 (`otel-no-pii-in-spans-lint`)
 *   - **Sandbox** → minimum-bar item #3 (`supervisor-sandbox-syscall-restriction`)
 *   - **Performance carve-out** → rule #13's relief-valve clause
 * Hardcoded (not glob-discovered) on purpose: a 6th bullet should land via
 * a visible ratchet PR alongside its rule extension, never in passing.
 */
export const REQUIRED_BULLETS = Object.freeze([
  "Trust boundary",
  "Secrets",
  "PII",
  "Sandbox",
  "Performance carve-out",
]);

/**
 * Build the bold-prefixed-bullet matcher for a label. The substrate's canonical
 * shape is `- **<label>**:`, but a forgiving matcher accepts:
 *   - `*` or `-` bullet marker
 *   - leading whitespace (nested bullet)
 *   - `:` immediately after the closing `**` OR the label being the whole bold
 *     run before any other punctuation
 * This guards against a rewrite that swaps `:` for `—` while still keeping the
 * substance — the gate's job is shape, not punctuation.
 *
 * @param {string} label
 * @returns {RegExp}
 */
function bulletRegex(label) {
  // Escape regex metacharacters in the label (none today, but defensive).
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*[-*]\\s+\\*\\*${escaped}\\*\\*`, "im");
}

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
 *   4. The section carries each of the 5 canonical bold-prefixed bullets in
 *      `REQUIRED_BULLETS` (Trust boundary / Secrets / PII / Sandbox /
 *      Performance carve-out). Pins substantive engagement with rule #13's
 *      minimum-bar items, not just citation.
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
  for (const label of REQUIRED_BULLETS) {
    if (!bulletRegex(label).test(section)) {
      errors.push(
        `section is missing the canonical \`- **${label}**\` bullet — rule #13 minimum-bar engagement requires all 5 bullets`,
      );
    }
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
  // Parallel reads: 6 files in flight at once vs. sequential. Saves ~50ms
  // wall-time on every CI run (6 × ~10ms read latency → ~10ms ceiling).
  // Per-file failures are caught individually so one missing file doesn't
  // mask the others — `checkAll` surfaces "file missing on disk" when a
  // path is absent from the resulting map.
  const reads = await Promise.all(
    USER_STORY_PATHS.map(async (rel) => {
      try {
        return /** @type {const} */ ([rel, await readFile(resolve(REPO_ROOT, rel), "utf8")]);
      } catch {
        return /** @type {const} */ ([rel, null]);
      }
    }),
  );
  /** @type {Map<string, string>} */
  const contents = new Map();
  for (const [rel, text] of reads) if (text !== null) contents.set(rel, text);
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
