#!/usr/bin/env node
// @ts-check
// Slice (d) of `self-metrics-competitive-benchmark`: the deterministic
// rule-#10 ratchet behind the optional-but-lint-enforced
// `**Competitive-goal**:` TASKS.md field.
//
// Source: rule #10 (vision.md § 10 / AGENTS.md § 10 — deterministic
//   enforcement, iron rule: every prose-only invariant gets a
//   deterministic linter as soon as the artefact it guards becomes
//   machine-readable); rule #9 (pre-registered hypothesis-driven
//   development — the `**Hypothesis**:` field is the existing,
//   already-deterministic non-triviality marker this gate reuses rather
//   than inventing a fuzzy heuristic); Basili, Caldiera, Rombach,
//   "The Goal-Question-Metric Approach", 1994 (every metric is derived
//   from a goal — here the goal is "beat competitors", so a
//   Hypothesis-bearing task must name the scorecard metric it moves);
//   Doerr, *Measure What Matters*, 2018 (OKR — every key result ties to
//   an objective); Ries, *The Lean Startup*, 2011 (the scorecard is the
//   learn loop); operator directive 2026-05-16 (the competitive north
//   star).
// Conformance: full — pure decision function over `{ tasksMd }`, thin
//   CLI wrapper owns I/O, no LLM in the chain.
//
// Why this gate exists: the task's meta-rule (slice (d)) makes "which
// scorecard metric does this task move?" a first-class, lint-enforced
// question. Without a deterministic gate the field is prose-only and
// rots — the exact rule-#10 failure mode. The non-triviality boundary
// is NOT a new heuristic: a task block that declares `**Hypothesis**:`
// is by rule #9's own definition non-trivial (trivial typo/docs/no-op
// changes are rule-#9-exempt and carry no Hypothesis). So the rule is:
// every Hypothesis-bearing task block MUST also declare
// `**Competitive-goal**:`.
//
// Dormant state (rule #7 — graceful degrade): the ratchet is OFF until
// the policy marker `<!-- policy: competitive-goal-enforced -->` appears
// in TASKS.md. Until the corpus is migrated, the CLI exits 0 with a
// stderr advisory. This is the same dormant-first activation precedent
// as `check-cadence-pivot-threshold` (ship the machinery green, flip a
// one-line marker once the guarded artefact is ready) — landing a
// hard-fail against the unmigrated corpus would mass-break every
// concurrent daemon PR, which is itself a rule-#11 (no flaky/instant-red
// gates) violation.
//
// Pivot (rule #9, this gate): if a fully shared head-to-head harness
// proves infeasible and the scorecard collapses to a published-numbers
// corpus, the field still names a corpus metric — keep this gate; only
// retire it if the `**Competitive-goal**:` field itself is removed from
// the task spec.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_TASKS_PATH = resolve(REPO_ROOT, "TASKS.md");

/**
 * Enforcement is dormant until this exact substring appears in TASKS.md
 * (canonically inside a `<!-- policy: competitive-goal-enforced -->`
 * comment, but matched as a bare substring so the activation flip is a
 * single trivially-greppable line). Locked by a paired test so a silent
 * rename surfaces loudly.
 */
export const ENFORCE_MARKER = "competitive-goal-enforced";

/** rule-#9 non-triviality marker — see module header. */
const HYPOTHESIS_RE = /\*\*Hypothesis\*\*/;
/** the field this gate enforces. */
const COMPETITIVE_GOAL_RE = /\*\*Competitive-goal\*\*/;
/** a top-level (column-0) task line: `- [ ] …` / `- [x] …`. */
const TOP_LEVEL_TASK_RE = /^- \[[ xX]\] (.+)$/;
/** a `## P0` / `# Tasks` heading ends the current block. */
const HEADING_RE = /^#{1,6} /;
/** `**ID**: foo` or `**ID**: \`foo\`` inside a block. */
const ID_FIELD_RE = /\*\*ID\*\*:\s*`?([A-Za-z0-9._/-]+)`?/;

/**
 * @typedef {{ id: string, raw: string }} TaskBlock
 * @typedef {{ id: string, reason: string }} Violation
 * @typedef {{ enforced: boolean, ok: boolean, violations: Violation[] }} CheckResult
 */

/**
 * Split a TASKS.md body into top-level task blocks. A block opens on a
 * column-0 `- [ ]`/`- [x]` line and runs until the next column-0 task
 * line or any markdown heading (`## P1`, etc.). Indented sub-tasks
 * (`  - [ ] …`) and `**Field**:` lines are absorbed into the current
 * block. Content before the first task (title, `<!-- policy -->`
 * comments) is ignored.
 *
 * @param {string} tasksMd
 * @returns {TaskBlock[]}
 */
export function parseTaskBlocks(tasksMd) {
  const lines = tasksMd.split("\n");
  /** @type {{ title: string, lines: string[] } | null} */
  let current = null;
  /** @type {{ title: string, lines: string[] }[]} */
  const blocks = [];
  for (const line of lines) {
    const m = line.match(TOP_LEVEL_TASK_RE);
    if (m) {
      if (current) blocks.push(current);
      current = { title: m[1] ?? line.trim(), lines: [line] };
      continue;
    }
    if (current === null) continue;
    if (HEADING_RE.test(line)) {
      blocks.push(current);
      current = null;
      continue;
    }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((b) => {
    const raw = b.lines.join("\n");
    const idMatch = raw.match(ID_FIELD_RE);
    const fallback = b.title.replace(/`/g, "").trim().slice(0, 60);
    const id = idMatch?.[1] ?? fallback;
    return { id, raw };
  });
}

/**
 * Pure decision function. When the enforcement marker is absent the
 * ratchet is dormant: `{ enforced: false, ok: true }`. When present,
 * every task block that declares `**Hypothesis**:` must also declare
 * `**Competitive-goal**:`.
 *
 * @param {{ tasksMd: string }} args
 * @returns {CheckResult}
 */
export function checkCompetitiveGoal({ tasksMd }) {
  if (!tasksMd.includes(ENFORCE_MARKER)) {
    return { enforced: false, ok: true, violations: [] };
  }
  /** @type {Violation[]} */
  const violations = [];
  for (const block of parseTaskBlocks(tasksMd)) {
    if (HYPOTHESIS_RE.test(block.raw) && !COMPETITIVE_GOAL_RE.test(block.raw)) {
      violations.push({
        id: block.id,
        reason: `task \`${block.id}\` declares **Hypothesis** (rule-#9 non-trivial) but omits **Competitive-goal**: name the competitive-scorecard metric it moves and the predicted delta.`,
      });
    }
  }
  return { enforced: true, ok: violations.length === 0, violations };
}

/**
 * Read TASKS.md. Returns `null` on ENOENT (dormant — rule #7). Throws on
 * other I/O errors (rule #6 let-it-crash).
 *
 * @param {string} path
 * @returns {string | null}
 */
export function readTasksMd(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * CLI. Exit codes: 0 — pass or dormant; 1 — violations (enforced); 2 —
 * I/O error.
 *
 * @returns {Promise<number>}
 */
async function main() {
  const path = process.argv[2] ?? DEFAULT_TASKS_PATH;
  /** @type {string | null} */
  let tasksMd;
  try {
    tasksMd = readTasksMd(path);
  } catch (err) {
    process.stderr.write(
      `competitive-goal: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  if (tasksMd === null) {
    process.stderr.write(
      `competitive-goal advisory: ${path} not present; lint dormant (rule #7 graceful degrade).\n`,
    );
    return 0;
  }
  // Skip-earlier optimization: when the ratchet is dormant — the common
  // case across the whole concurrent-daemon swarm until the corpus is
  // migrated — return on a single substring scan and NEVER pay the
  // O(file) `parseTaskBlocks` split + per-block regex sweep over the
  // multi-thousand-line TASKS.md. The pure function repeats the cheap
  // check for unit-test self-containment; this branch is what keeps the
  // gate's full-stage cost negligible on every push.
  if (!tasksMd.includes(ENFORCE_MARKER)) {
    process.stderr.write(
      `competitive-goal advisory: enforcement marker '<!-- policy: ${ENFORCE_MARKER} -->' absent in ${path}; ratchet dormant until the corpus is migrated (slice (d) of self-metrics-competitive-benchmark).\n`,
    );
    return 0;
  }
  const result = checkCompetitiveGoal({ tasksMd });
  if (!result.ok) {
    process.stderr.write(
      `competitive-goal violation (${result.violations.length}):\n${result.violations
        .map((v) => `  - ${v.reason}`)
        .join("\n")}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `competitive-goal ok: every Hypothesis-bearing task block declares **Competitive-goal** (${path}).\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-competitive-goal.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
