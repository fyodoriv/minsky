#!/usr/bin/env node
// Pattern: deterministic CI gate over the skill-primer ↔ glossary-allowlist
//   coupling (rule #10 deterministic enforcement applied to rule #5).
// Source: rule #5 (theoretical grounding — every Minsky-coined token resolves
//   to an anchor; a `.claude/skills/<name>/` directory is a coined token whose
//   anchor is the SKILL.md file itself, recorded on the allowlist); rule #10
//   (vision.md § 10 — every constitutional rule needs a deterministic gate);
//   Beck, *Extreme Programming Explained*, 1999 (CI as the constraint
//   enforcer).
// Conformance: full — pure function (`checkSkillAllowlistCoverage`) + thin CLI
//   wrapper; the only I/O (directory walk + file read) lives in the injectable
//   `listSkillNames` / `readAllowlist` seams, no LLM in the chain.
//
// Why this gate exists: when a PR adds a skill primer in
// `.claude/skills/<name>/SKILL.md` and later cites the `<name>` token in
// `vision.md`, the rule-5 glossary-discipline lint (`check-rule-5-glossary-
// discipline.mjs`) demands that token resolve to the allowlist. But that
// check only fires once vision.md cites the token — so a forgotten allowlist
// entry stays invisible until a *later* PR adds the citation, at which point
// the failure lands far from the skill that introduced it. The 2026-05-21
// PR #696/#704 cycle is the canonical recurrence: #696 shipped
// `.claude/skills/pr-merge-no-shortcuts/SKILL.md` + cited it in vision.md §18
// without the allowlist entry; an intervening merge dropped the entry; #704
// had to re-add it. This lint closes the loop at the source — it asserts
// EVERY skill directory under `.claude/skills/` (and `.devin/skills/`) has its
// name on the allowlist, regardless of whether vision.md cites it yet, so a
// forgotten entry fails in the same PR that adds the skill.
//
// Hypothesis (this gate's reason for existing): a deterministic check that
// every skill directory name appears in `scripts/glossary-allowlist.txt`
// makes it impossible to add a skill primer without the allowlist entry. The
// check is a directory walk + one file read — sub-50ms, full-stage budget
// unaffected.
//
// Pivot (rule #9): if maintaining the allowlist by hand becomes its own toil,
// derive the skill-name subset of the allowlist from the directory listing
// (`node scripts/derive-skill-list.mjs`, committed via lefthook post-commit)
// and have this lint check the derived block instead. Until that toil shows
// up, the hand-maintained list + this gate is the lighter substrate.
//
// Measurement: `node scripts/check-skill-allowlist-coverage.mjs` exits 0 iff
// every skill dir name is on the allowlist; `pnpm vitest run
// scripts/check-skill-allowlist-coverage.test.mjs` exercises the pure core.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAllowlist } from "./check-rule-5-glossary-discipline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// The skill roots the gate covers. Both are agent-config directories that hold
// one `<name>/SKILL.md` per skill; the directory name IS the coined token the
// allowlist anchors. `.devin/skills/` may be absent on a Claude-only checkout —
// a missing root contributes zero skill names, never an error.
export const DEFAULT_SKILL_ROOTS = Object.freeze([".claude/skills", ".devin/skills"]);

const ALLOWLIST_REL_PATH = "scripts/glossary-allowlist.txt";

/**
 * @typedef {{ skillNames: string[], missing: string[] }} CoverageResult
 */

/**
 * Pure function: given the set of discovered skill directory names and the
 * allowlist token set, return the names missing from the allowlist (sorted,
 * deduped). `missing.length === 0` is a pass.
 *
 * @param {{ skillNames: Iterable<string>, allowlist: Set<string> }} args
 * @returns {CoverageResult}
 */
export function checkSkillAllowlistCoverage({ skillNames, allowlist }) {
  const names = [...new Set(skillNames)].sort();
  const missing = names.filter((n) => !allowlist.has(n));
  return { skillNames: names, missing };
}

/**
 * Build the violation message for the missing names. Pure helper so the test
 * can pin the wording without spawning the CLI.
 *
 * @param {string[]} missing
 * @returns {string}
 */
export function buildViolationMessage(missing) {
  const list = missing.map((n) => `  - ${n}`).join("\n");
  return [
    `skill-allowlist-coverage violation: ${missing.length} skill primer director${
      missing.length === 1 ? "y is" : "ies are"
    } missing from ${ALLOWLIST_REL_PATH}:`,
    list,
    "",
    "Each `.claude/skills/<name>/SKILL.md` (or `.devin/skills/<name>/`) is a",
    "coined token whose anchor is the SKILL.md file itself (rule #5). Add the",
    `directory name to ${ALLOWLIST_REL_PATH} in THIS PR so a later vision.md`,
    "citation doesn't fail the rule-5 glossary-discipline check far from the",
    "skill that introduced it (the 2026-05-21 PR #696/#704 cycle).",
  ].join("\n");
}

/**
 * I/O seam helper: add every `<name>` directory under `absRoot` that holds a
 * `SKILL.md` to `names`. A missing root is a no-op (a Claude-only checkout has
 * no `.devin/skills/`). Split out of `listSkillNames` to keep that function's
 * cognitive complexity under biome's ceiling.
 *
 * @param {string} absRoot
 * @param {Set<string>} names
 * @returns {void}
 */
function collectSkillNamesUnder(absRoot, names) {
  if (!existsSync(absRoot)) return;
  for (const entry of readdirSync(absRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(resolve(absRoot, entry.name, "SKILL.md"))) {
      names.add(entry.name);
    }
  }
}

/**
 * I/O seam: list the `<name>` directory names that contain a `SKILL.md` under
 * each root in `roots`, relative to `repoRoot`. Replaceable in tests so the
 * pure core never touches the filesystem.
 *
 * @param {string[]} roots
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listSkillNames(roots, repoRoot) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const root of roots) {
    collectSkillNamesUnder(resolve(repoRoot, root), names);
  }
  return [...names];
}

/**
 * CLI: discover skill names, parse the allowlist, exit 1 when any skill
 * directory name is absent from the allowlist.
 *
 * @returns {number}
 */
function main() {
  const skillNames = listSkillNames([...DEFAULT_SKILL_ROOTS], REPO_ROOT);
  const allowlist = parseAllowlist(readFileSync(resolve(REPO_ROOT, ALLOWLIST_REL_PATH), "utf8"));
  const result = checkSkillAllowlistCoverage({ skillNames, allowlist });
  if (result.missing.length === 0) {
    process.stdout.write(
      `skill-allowlist-coverage ok: ${result.skillNames.length} skill primer(s) all on the allowlist.\n`,
    );
    return 0;
  }
  process.stderr.write(`${buildViolationMessage(result.missing)}\n`);
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-skill-allowlist-coverage.mjs");
if (invokedDirectly) {
  process.exit(main());
}
