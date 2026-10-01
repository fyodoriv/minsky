#!/usr/bin/env node
// @ts-check
// check-bot-commit-hook-bypass — rule #10 deterministic lint that every
// GitHub-Actions workflow step which runs `git commit` ALSO disables the
// repo's local lefthook hooks for that commit.
//
// Why: lefthook's `pre-commit` hooks (e.g. `check-toolchain`) assume a
// darwin-arm64 developer machine — they probe for the macOS-only biome
// optionalDependency and HARD-FAIL on a fresh linux/x64 CI runner where that
// dep isn't resolved. A bot commit (github-actions[bot] writing back
// experiment-store records / replay verdicts on a paths-restricted change) is
// NOT a human developer commit and must not be gated by the local-dev hooks.
// PR #710 fixed ONE workflow (experiment.yml) by adding
// `git config core.hooksPath /dev/null` before its commit, but the fix was
// local — every other bot-commit workflow would trip the same class on its
// next CI run. This lint makes the discipline repo-wide.
//
// What counts as a bypass (CI-bot-safe forms only — NOT `--no-verify`, which
// `scripts/check-no-no-verify-bypass.mjs` independently BANS per AGENTS.md
// §"Git Safety" + claude-code GHE #40117):
//   1. `git config core.hooksPath /dev/null` somewhere in the SAME step's
//      `run:` block (the experiment.yml form), OR
//   2. `LEFTHOOK: "0"` (lefthook's documented env escape hatch) in the step's
//      `env:` block (the peter-evans/create-pull-request form, whose commit is
//      internal to the action and therefore not visible in any `run:` text).
//
// The two forms differ because the commit happens in two different places:
// inline `run:` shell vs an `uses:` action's internal git. The lint accepts
// either, keyed per step.
//
// Pattern: deterministic gate (rule #10) — `checkBotCommitHookBypass` is a pure
//   function over the parsed-workflow text map; the I/O (directory walk, file
//   reads) lives at the CLI boundary and is replaceable via injection for the
//   paired tests (rule #2 — the file map is the seam). Conformance: full.
// Source: TASKS.md `lefthook-bot-commit-bypass-discipline`; vision.md rule #10
//   (every constitutional rule enforced by a deterministic CI check, not "the
//   agent will remember"); 2026-05-21 PR #710 (the original local fix);
//   git-scm.com/docs/git-config (`core.hooksPath`); lefthook docs (`LEFTHOOK=0`).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const WORKFLOWS_DIR = ".github/workflows";

/** Matches a `git commit` invocation (start of a shell word). */
const GIT_COMMIT_RE = /(^|[;&|]\s*|\s)git\s+commit\b/;

/**
 * Matches the accepted inline bypass: `git config core.hooksPath /dev/null`
 * (with or without `--local`/`--global`, any whitespace, optional `=`).
 */
const HOOKS_PATH_BYPASS_RE = /\bgit\s+config\b[^\n]*\bcore\.hooksPath\b[^\n]*\/dev\/null\b/;

/**
 * Matches the accepted step-env bypass: `LEFTHOOK: "0"` / `LEFTHOOK: '0'` /
 * `LEFTHOOK: 0`. lefthook's documented escape hatch disables the binary for
 * the duration of the step (covers an `uses:` action's internal git commit).
 */
const LEFTHOOK_OFF_RE = /^\s*LEFTHOOK:\s*['"]?0['"]?\s*$/;

/**
 * @typedef {object} CommitStep
 * @property {string} file       workflow file basename
 * @property {string} stepName   the step's `name:` (or "<unnamed step>")
 * @property {number} line       1-based line where `git commit` appears
 * @property {boolean} bypassed  true when a hooks-path or LEFTHOOK=0 bypass applies
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {CommitStep[]} commitSteps   every bot-commit step found (for tests)
 * @property {number} scannedCount        number of workflow files scanned
 */

/**
 * @typedef {object} CheckOpts
 * @property {Record<string, string>} [workflowTexts]  basename → raw yaml text;
 *   when omitted, the CLI boundary reads `.github/workflows/*.yml`.
 * @property {string} [repoRoot]
 */

/**
 * Pure check. See module header for semantics. Operates on a map of
 * workflow-file basename → raw text so the paired tests can inject fixtures
 * without writing files.
 *
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkBotCommitHookBypass(opts = {}) {
  const workflowTexts = opts.workflowTexts ?? defaultWorkflowTexts(opts.repoRoot ?? REPO_ROOT);
  /** @type {CommitStep[]} */
  const commitSteps = [];

  for (const [file, text] of Object.entries(workflowTexts)) {
    for (const step of parseCommitSteps(file, text)) {
      commitSteps.push(step);
    }
  }

  const violations = commitSteps
    .filter((s) => !s.bypassed)
    .map(
      (s) =>
        `${s.file}:${s.line}: step "${s.stepName}" runs \`git commit\` without a lefthook bypass. ` +
        "Add `git config core.hooksPath /dev/null` before the commit (inline run) OR " +
        '`env: { LEFTHOOK: "0" }` on the step (uses: action). See ' +
        "TASKS.md `lefthook-bot-commit-bypass-discipline`.",
    );

  return {
    ok: violations.length === 0,
    violations,
    commitSteps,
    scannedCount: Object.keys(workflowTexts).length,
  };
}

/**
 * Split a workflow's lines into steps and, for each step that runs
 * `git commit`, decide whether a bypass is present.
 *
 * The parser is intentionally line/indent-based (no `yaml` dependency — matches
 * the no-dep convention of the other workflow lints, e.g.
 * `check-pre-push-hook-fast.mjs`). A "step" begins at a list-item line
 * (`- name:` / `- uses:` / `- run:` / a bare `-`) inside a `steps:` block and
 * runs until the next list item at the same indent. Within a step we collect
 * the `run:` block-scalar text and the `env:` block text, then test:
 *   - the `run:` text against GIT_COMMIT_RE and HOOKS_PATH_BYPASS_RE, and
 *   - the `env:` lines against LEFTHOOK_OFF_RE.
 *
 * A step with no `git commit` in its `run:` text is ignored entirely — the
 * `uses:`-action case only matters when the action commits, but we cannot see
 * an action's internals; we therefore only flag steps whose VISIBLE shell runs
 * `git commit`. The peter-evans/create-pull-request steps run no `git commit`
 * in `run:`, so they never trip this lint regardless of their LEFTHOOK env.
 *
 * @param {string} file
 * @param {string} text
 * @returns {CommitStep[]}
 */
export function parseCommitSteps(file, text) {
  const lines = text.split("\n");
  /** @type {CommitStep[]} */
  const out = [];
  for (const block of splitSteps(lines)) {
    const commitLine = findCommitLine(block.lines, block.startLine);
    if (commitLine === null) continue;
    const runText = block.lines.join("\n");
    const bypassed = HOOKS_PATH_BYPASS_RE.test(runText) || stepEnvDisablesLefthook(block.lines);
    out.push({
      file,
      stepName: extractStepName(block.lines),
      line: commitLine,
      bypassed,
    });
  }
  return out;
}

/**
 * @typedef {object} StepBlock
 * @property {string[]} lines      the step's raw lines
 * @property {number} startLine    1-based line number of the step's first line
 */

/**
 * @typedef {object} StepsRegion
 * @property {number} start    0-based index of the first line AFTER `steps:`
 * @property {number} end      0-based index one past the region's last line
 * @property {number} keyIndent   indent of the `steps:` key
 */

/**
 * Group a workflow's lines into step blocks. Only list items inside a `steps:`
 * block count — this avoids mistaking the `on.schedule` `- cron:` list (or any
 * other YAML sequence at a shallower indent) for a step boundary, which was the
 * bug that merged every step into one block and let a later step's
 * `LEFTHOOK: "0"` leak onto an unrelated commit.
 *
 * Algorithm: (1) find every `steps:` region (the contiguous run of lines more
 * indented than the `steps:` key); (2) within each region, the step indent is
 * the indent of the region's first list item, and a new step begins at each
 * list item AT that indent.
 *
 * @param {string[]} lines
 * @returns {StepBlock[]}
 */
function splitSteps(lines) {
  /** @type {StepBlock[]} */
  const blocks = [];
  for (const region of findStepsRegions(lines)) {
    const stepIndent = firstListItemIndent(lines, region);
    if (stepIndent === -1) continue;
    splitRegionInto(lines, region, stepIndent, blocks);
  }
  return blocks;
}

/**
 * Split one `steps:` region into step blocks (a new block at each list item
 * whose indent equals `stepIndent`), appending to `blocks`. Extracted from
 * `splitSteps` to keep both functions under the cognitive-complexity ceiling.
 *
 * @param {string[]} lines
 * @param {StepsRegion} region
 * @param {number} stepIndent
 * @param {StepBlock[]} blocks
 */
function splitRegionInto(lines, region, stepIndent, blocks) {
  /** @type {string[] | null} */
  let current = null;
  let currentStart = 0;
  for (let i = region.start; i < region.end; i++) {
    const line = lines[i] ?? "";
    if (isListItemAtIndent(line, stepIndent)) {
      if (current !== null) blocks.push({ lines: current, startLine: currentStart });
      current = [line];
      currentStart = i + 1;
      continue;
    }
    if (current !== null) current.push(line);
  }
  if (current !== null) blocks.push({ lines: current, startLine: currentStart });
}

/**
 * @param {string} line
 * @param {number} indent
 * @returns {boolean}
 */
function isListItemAtIndent(line, indent) {
  const m = /^(\s*)-(\s|$)/.exec(line);
  return m !== null && m[1] !== undefined && m[1].length === indent;
}

/**
 * Find each `steps:` region: from the line after a `steps:` key, up to the
 * next line whose indent is ≤ the `steps:` key's indent (dedent = region end).
 *
 * @param {string[]} lines
 * @returns {StepsRegion[]}
 */
function findStepsRegions(lines) {
  /** @type {StepsRegion[]} */
  const regions = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)steps:\s*$/.exec(lines[i] ?? "");
    if (m === null || m[1] === undefined) continue;
    const keyIndent = m[1].length;
    regions.push({ start: i + 1, end: regionEnd(lines, i + 1, keyIndent), keyIndent });
  }
  return regions;
}

/**
 * Walk forward from `start` until a non-blank line dedents to ≤ `keyIndent`.
 * Returns the 0-based index one past the region's last line.
 *
 * @param {string[]} lines
 * @param {number} start
 * @param {number} keyIndent
 * @returns {number}
 */
function regionEnd(lines, start, keyIndent) {
  let end = start;
  while (end < lines.length) {
    const l = lines[end] ?? "";
    if (l.trim().length > 0 && indentOf(l) <= keyIndent) break;
    end++;
  }
  return end;
}

/**
 * Indent (leading-space count) of the first `-` list item inside a region,
 * or -1 when the region has none.
 *
 * @param {string[]} lines
 * @param {StepsRegion} region
 * @returns {number}
 */
function firstListItemIndent(lines, region) {
  for (let i = region.start; i < region.end; i++) {
    const m = /^(\s*)-(\s|$)/.exec(lines[i] ?? "");
    if (m && m[1] !== undefined) return m[1].length;
  }
  return -1;
}

/**
 * @param {string} line
 * @returns {number}
 */
function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  return m && m[1] !== undefined ? m[1].length : 0;
}

/**
 * Find the 1-based line number where `git commit` appears inside a step's
 * lines, skipping pure-comment lines (a `# ... git commit ...` mention is not
 * an invocation). Returns null when the step runs no `git commit`.
 *
 * @param {string[]} blockLines
 * @param {number} startLine   1-based line of blockLines[0] in the file
 * @returns {number | null}
 */
function findCommitLine(blockLines, startLine) {
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i] ?? "";
    if (/^\s*#/.test(line)) continue;
    if (GIT_COMMIT_RE.test(line)) return startLine + i;
  }
  return null;
}

/**
 * Test whether the step's `env:` block sets `LEFTHOOK: "0"`. Scans every line
 * of the step (the env block is a sub-key of the step) for the off pattern.
 *
 * @param {string[]} blockLines
 * @returns {boolean}
 */
function stepEnvDisablesLefthook(blockLines) {
  return blockLines.some((l) => LEFTHOOK_OFF_RE.test(l));
}

/**
 * Pull the step's display name from a `name:` key, defaulting to a placeholder
 * when the step is unnamed (bare `- run:`).
 *
 * @param {string[]} blockLines
 * @returns {string}
 */
function extractStepName(blockLines) {
  for (const line of blockLines) {
    const m = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line);
    if (m && m[1] !== undefined) return m[1].replace(/^['"]|['"]$/g, "");
  }
  return "<unnamed step>";
}

/**
 * I/O boundary: read every `.github/workflows/*.yml` into a basename → text
 * map. Replaced by the `workflowTexts` injection in tests.
 *
 * @param {string} repoRoot
 * @returns {Record<string, string>}
 */
function defaultWorkflowTexts(repoRoot) {
  const dir = resolve(repoRoot, WORKFLOWS_DIR);
  /** @type {Record<string, string>} */
  const out = {};
  let entries;
  try {
    entries = readdirSync(dir);
    // rule-6: handled-locally — a missing workflows dir (minimal checkout)
    // should not crash the gate; treat as "nothing to scan".
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    try {
      out[entry] = readFileSync(resolve(dir, entry), "utf8");
    } catch {
      // Unreadable file — skip; the directory listing already proves it exists.
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkBotCommitHookBypass();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-bot-commit-hook-bypass: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: bot commits in CI must disable lefthook (the local-dev pre-commit hooks " +
      "assume darwin-arm64 and fail on a linux/x64 runner). Use " +
      "`git config core.hooksPath /dev/null` before the commit, NOT --no-verify.",
  );
  process.exit(1);
}
