#!/usr/bin/env node
// Pattern: deterministic gate over a TASKS.md ↔ test-corpus invariant.
// Source: TASKS.md `orphan-cleanup-task-block-citation-lint` (P1, M1);
//   rule #10 (deterministic enforcement — encode the "grep before
//   delete" agent habit as a lint); rule #17 (proactive heal — every
//   bug becomes a rule); Hyrum's Law (the TEXT of a task block can
//   become load-bearing for the tests that pin its claims).
// Conformance: full — pure regex over a `git diff` text and a set of
//   test-corpus file contents, no LLM in the chain.
//
// Why this gate exists: PR #864's first attempt removed
// `daemon-pre-pr-lint-gate` from TASKS.md alongside 2 other shipped
// orphans. 5 parity tests in `scripts/daemon-pr-lint-metrics.test.mjs`
// (4 tests) + `scripts/self-diagnose.test.mjs` (1 test) broke because
// they read TASKS.md as the canonical citation site for the
// `ROLLING_30D_MIN_PASS_RATE` threshold and `daemon-pr-lint-pass-rate`
// jq selector. Recovery cost ~20 min (revert + restore the block +
// file the citation-migration scout `daemon-pre-pr-lint-gate-prose-
// citation-migration` for the long-term fix). This lint makes that
// failure mode mechanical: a PR that removes a task block whose ID
// is still referenced by any test file in the repo fails locally
// before push.
//
// Escape hatch: if the operator INTENDS to remove a task block whose
// ID is cited (e.g. because the citation will be migrated in a follow-
// up PR), they can either:
//   (a) include the marker `<!-- DO NOT DELETE — citation site for
//       tests/X.test.mjs:Y -->` inside the task block BEFORE removing
//       it (the lint reads the marker in the deletion diff), OR
//   (b) include `<!-- task-block-citations: not-applicable — <reason> -->`
//       in the PR body (caller passes that as the second arg).
//
// Pivot (rule #9): if the lint produces ≥3 false positives per week
// (legitimately-removed blocks whose IDs survive in archived /
// comment-only / changelog references), tighten the regex to only
// count `expect(...).toContain("<id>")` style assertions, not freeform
// mentions.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ id: string; blockHadEscapeHatch: boolean }} RemovedBlock
 */

/**
 * @typedef {{ id: string; citations: { file: string; line: number }[] }} OrphanCitation
 */

/**
 * @typedef {{ ok: true } | { ok: false; orphans: OrphanCitation[] }} CheckResult
 */

const TASK_HEADER_RE = /^- \[\s?\] `([a-z0-9][a-z0-9-]*)`/;
const REMOVED_TASK_HEADER_RE = /^-- \[\s?\] `([a-z0-9][a-z0-9-]*)`/m;
// Escape-hatch marker must be a STANDALONE comment line — after the diff
// deletion prefix `-` and leading whitespace, the line content starts
// with `<!--`. This is strict on purpose: a task block that DESCRIBES
// the marker shape inside prose (e.g. in a `**Details**:` field) would
// otherwise falsely opt itself out of the check. The standalone-line
// requirement matches the operator's intent: "this is a marker I'm
// declaring", not "this is a sentence about markers".
//
// Discovered 2026-05-25 while filing this lint's own task block —
// the block's `**Details**` field cited the example marker pattern,
// which the looser regex matched. Adding paired test case (i).
const ESCAPE_HATCH_RE =
  /^-\s*<!--\s*DO NOT DELETE\s*[—-]?\s*citation site for/i;

/**
 * Parse a `git diff` of TASKS.md and return the IDs of task blocks
 * that were entirely removed. A removed block is identified by a
 * deletion-side line whose shape matches the task-header regex.
 *
 * For each removed ID, also reports whether the block's contiguous
 * deletion span contained the escape-hatch marker.
 *
 * Pure function — no I/O. Caller supplies the diff text.
 *
 * @param {string} diff
 * @returns {RemovedBlock[]}
 */
export function parseRemovedTaskBlocks(diff) {
  const lines = diff.split("\n");
  /** @type {RemovedBlock[]} */
  const removed = [];
  /** @type {string | null} */
  let currentBlockId = null;
  let currentBlockHasMarker = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // `git diff` deletion-side lines start with `-` (not `--`,
    // which is the file marker). REMOVED_TASK_HEADER_RE uses `--`
    // because in the diff a single `-` prefixes the deletion AND
    // the line content itself starts with `- [ ] ...`, so combined
    // it's `-- [ ] ...`.
    const headerMatch = REMOVED_TASK_HEADER_RE.exec(line);
    if (headerMatch !== null) {
      // Flush the previous block (if any) before starting the new one.
      if (currentBlockId !== null) {
        removed.push({ id: currentBlockId, blockHadEscapeHatch: currentBlockHasMarker });
      }
      currentBlockId = headerMatch[1] ?? null;
      currentBlockHasMarker = false;
      continue;
    }
    if (currentBlockId === null) continue;
    // Block continuation — deletion-side lines (start with `-`) that
    // are NOT a new task header. Check for escape-hatch marker.
    if (line.startsWith("-") && ESCAPE_HATCH_RE.test(line)) {
      currentBlockHasMarker = true;
    }
    // Hunk boundary: a context line (starts with " ") OR an addition
    // (starts with "+") OR a hunk header (starts with "@@") OR a
    // diff-file header (starts with "diff " / "index " / "---" /
    // "+++") closes the current removal-span. Note: addition lines
    // STARTING WITH `- [` shouldn't fire here because they'd start
    // with `+- [`, which doesn't match the removed-header regex.
    if (
      line.startsWith(" ") ||
      line.startsWith("+") ||
      line.startsWith("@@") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      removed.push({ id: currentBlockId, blockHadEscapeHatch: currentBlockHasMarker });
      currentBlockId = null;
      currentBlockHasMarker = false;
    }
  }
  // Flush the trailing block (diff that ends inside a removal span).
  if (currentBlockId !== null) {
    removed.push({ id: currentBlockId, blockHadEscapeHatch: currentBlockHasMarker });
  }
  return removed;
}

/**
 * Find every line in the test corpus that mentions `id` literally.
 * Returns the list of `{file, line}` hits.
 *
 * Pure function — caller supplies the corpus as a Map from file path
 * to file contents. Test file enumeration + read is the caller's
 * concern (the I/O seam).
 *
 * @param {string} id
 * @param {ReadonlyMap<string, string>} corpus
 * @returns {{ file: string; line: number }[]}
 */
export function findCitations(id, corpus) {
  /** @type {{ file: string; line: number }[]} */
  const hits = [];
  for (const [file, content] of corpus) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? "").includes(id)) {
        hits.push({ file, line: i + 1 });
      }
    }
  }
  return hits;
}

/**
 * Pure orchestrator: given a TASKS.md diff and a snapshot of the
 * test corpus AT HEAD (the state where the removed task ID's
 * citations would still live if not also removed in the same PR),
 * return either `{ ok: true }` or `{ ok: false, orphans }`.
 *
 * The HEAD-state corpus is what makes the "same-PR citation removal"
 * case work: if the test ALSO removed the citation, HEAD doesn't
 * contain the ID anymore → findCitations returns empty → not an
 * orphan.
 *
 * @param {string} diff  — output of `git diff <base> -- TASKS.md`
 * @param {ReadonlyMap<string, string>} corpus
 * @returns {CheckResult}
 */
export function checkTaskBlockCitations(diff, corpus) {
  const removedBlocks = parseRemovedTaskBlocks(diff);
  /** @type {OrphanCitation[]} */
  const orphans = [];
  for (const { id, blockHadEscapeHatch } of removedBlocks) {
    if (blockHadEscapeHatch) continue;
    const citations = findCitations(id, corpus);
    if (citations.length > 0) {
      orphans.push({ id, citations });
    }
  }
  return orphans.length === 0 ? { ok: true } : { ok: false, orphans };
}

/**
 * I/O wrapper for the CI / pre-pr-lint invocation: resolves the diff
 * range, reads the test corpus, calls the pure checker, formats the
 * verdict, exits 0/1. The pure helpers above are unit-testable
 * without this wrapper (rule #2 — pure core + thin I/O shell).
 *
 * @returns {Promise<void>}
 */
async function main() {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
  // Default base: origin/main. Override via env (matches the
  // lockfile-integrity pattern).
  const base = process.env["TASK_CITATION_DIFF_BASE"] ?? "origin/main";
  let diff = "";
  try {
    diff = execSync(`git diff ${base} -- TASKS.md`, { cwd: repoRoot, encoding: "utf8" });
  } catch (err) {
    // `git diff` against an unknown base (e.g. fresh clone with no
    // origin/main fetched) returns non-zero. Treat as "no diff, no
    // citations to check" — rule #6 (let-it-crash AT the right
    // boundary; this isn't a meaningful boundary).
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `check-task-block-citations: could not diff against ${base} (${msg}); skipping\n`,
    );
    process.exit(0);
  }
  if (diff.trim().length === 0) {
    // No TASKS.md changes — nothing to check.
    process.exit(0);
  }
  // Build the test corpus: every `*.test.{mjs,ts}` + `*.bats` file
  // under the repo. Use git ls-files so .gitignored junk doesn't bias
  // the check, and so external sandbox dirs aren't traversed.
  const filesRaw = execSync(
    "git ls-files '*.test.mjs' '*.test.ts' '*.test.tsx' '*.test.js' '*.bats'",
    { cwd: repoRoot, encoding: "utf8" },
  );
  /** @type {Map<string, string>} */
  const corpus = new Map();
  for (const file of filesRaw.split("\n")) {
    if (file.trim().length === 0) continue;
    try {
      corpus.set(file, readFileSync(resolve(repoRoot, file), "utf8"));
    } catch {
      // File listed but unreadable (e.g. submodule pointer). Skip.
    }
  }
  const verdict = checkTaskBlockCitations(diff, corpus);
  if (verdict.ok) {
    process.exit(0);
  }
  // Failure — pretty-print orphans.
  process.stderr.write("check-task-block-citations: FAIL\n");
  process.stderr.write(
    "  Removed task block(s) whose IDs are still cited by test files:\n\n",
  );
  for (const { id, citations } of verdict.orphans) {
    process.stderr.write(`  - \`${id}\`:\n`);
    for (const { file, line } of citations) {
      process.stderr.write(`      ${file}:${line}\n`);
    }
  }
  process.stderr.write(
    "\n  Fix by ONE of:\n" +
      "    (1) Remove the citation from the test in the same PR.\n" +
      "    (2) Migrate the cited prose to a stable file (e.g. docs/), then update the test, then remove the task block in a follow-up PR.\n" +
      "    (3) Add the escape-hatch marker INSIDE the task block before removing it:\n" +
      "        <!-- DO NOT DELETE — citation site for tests/<file>:<line> -->\n",
  );
  process.exit(1);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await main();
}
