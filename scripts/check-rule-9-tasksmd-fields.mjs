#!/usr/bin/env node
// @ts-check
// Rule #9 deterministic lint over `TASKS.md` task blocks.
//
// Rule #9 (vision.md § "Pre-registered hypothesis-driven development —
// iron rule"): every task block ships with **Hypothesis**, **Success**
// (or **Acceptance** — equivalent semantics, the field name varies),
// **Pivot**, **Measurement**, and **Anchor**. Without all five the
// "iron" rule is just spec — operators silently drop Success or
// Pivot and the rule degrades to wish-list (the failure mode rule #9
// itself names: "without pre-registration, even measured changes
// degenerate into fishing expeditions").
//
// 2026-05-19 audit found 26 of 152 task blocks violate the rule. Per
// the rule-#10 ratchet model, the right move is:
//   1. Build the deterministic gate;
//   2. Allowlist the existing violators by ID (audit trail visible);
//   3. Block every NEW or modified task that doesn't carry all five.
// As the audit-gap-loop closes, IDs leave the allowlist; eventually
// the allowlist is empty and the rule is iron in practice, not just
// in vision.md.
//
// Pattern: deterministic gate over TASKS.md (rule #10).
// Source: rule #9 (vision.md § "Pre-registered hypothesis-driven
//   development — iron rule"); rule #10 (deterministic enforcement);
//   rule #17 (proactive healing — observed gap is a fix); operator
//   directive 2026-05-19 ("continue getting minsky to follow its own
//   principles").
// Conformance: full — pure function over TASKS.md text.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Tasks that pre-date the lint and are exempt until backfilled. Each
 *  entry should eventually be removed via the
 *  `rule-9-tasksmd-fields-backfill` task (filed in this PR). New tasks
 *  added after 2026-05-19 are NEVER exempt — the lint blocks them.
 *
 *  @type {ReadonlySet<string>}
 */
export const RULE_9_GRANDFATHERED = Object.freeze(
  new Set([
    "minsky-cli-auto-bootstrap-local-llm",
    "minsky-cli-fresh-clone-bootstrap",
    "minsky-runtime-resilience",
    "minsky-claude-exhaustion-persisted-state",
    "minsky-cli-context-aware-ux",
    "daemon-aider-brief-shrinker",
    "daemon-claude-print-hang-watchdog",
    "daemon-stuck-pr-rebase-watchdog",
    "daemon-duplicate-work-detection",
    "daemon-pr-age-watchdog",
    "cto-audit-pr-auto-merge",
    "daemon-pre-pr-lint-gate",
    "daemon-fix-own-pr-on-ci-failure",
    "daemon-self-detect-throughput-issues",
    "devin-spawn-missing-permission-mode-bypass",
    "dashboard-web-rich-runs-view",
    "local-agent-config-validation-at-boot",
    "daemon-iteration-phase-tagged-spans",
    "daemon-config-analyzer-auto-apply",
    "daemon-launchd-drift-warning-suppress-when-cli-launched",
    "daemon-task-rotation-on-completion",
    "daemon-tasks-md-auto-lint-fix",
    "competitive-benchmark-real-automated-weekly",
    "minsky-update-cli",
    "minsky-config-bootstrap-prompt",
    "self-metrics-competitive-benchmark",
    "daemon-brief-test-pin-soft-tolerance",
    "dependabot-bumps-dep-regression-triage",
    "spawn-n-workers-with-watchdog-monitoring",
    "brief-trim-coordinator",
    "local-worktree-followups",
    "gitignore-claire-runtime-dir",
  ]),
);

/**
 * @typedef {object} TaskBlock
 * @property {string} id
 * @property {string} body          full block text including ID line
 * @property {ReadonlyArray<string>} missingFields  e.g. ["Success/Acceptance", "Pivot"]
 */

/**
 * Pure function. Returns one entry per task block.
 *
 * @param {string} tasksMd
 * @returns {readonly TaskBlock[]}
 */
export function parseRule9Blocks(tasksMd) {
  /** @type {TaskBlock[]} */
  const out = [];
  const idRe = /^\s*-\s*\*\*ID\*\*:\s*([a-z0-9][a-z0-9-]*[a-z0-9])\s*$/gm;
  /** @type {{ id: string, start: number }[]} */
  const heads = [];
  for (;;) {
    const m = idRe.exec(tasksMd);
    if (m === null) break;
    if (m[1] === undefined) continue;
    heads.push({ id: m[1], start: m.index });
  }
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (head === undefined) continue;
    const next = heads[i + 1];
    const end = next === undefined ? tasksMd.length : next.start;
    const body = tasksMd.slice(head.start, end);
    out.push({ id: head.id, body, missingFields: missingFieldsIn(body) });
  }
  return out;
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function missingFieldsIn(body) {
  /** @type {string[]} */
  const missing = [];
  if (!body.includes("**Hypothesis**:")) missing.push("Hypothesis");
  if (!(body.includes("**Success**:") || body.includes("**Acceptance**:"))) {
    missing.push("Success/Acceptance");
  }
  if (!body.includes("**Pivot**:")) missing.push("Pivot");
  if (!body.includes("**Measurement**:")) missing.push("Measurement");
  if (!body.includes("**Anchor**:")) missing.push("Anchor");
  return missing;
}

/**
 * @param {readonly TaskBlock[]} blocks
 * @param {ReadonlySet<string>} grandfathered
 * @returns {{ blocking: readonly TaskBlock[], grandfathered: readonly TaskBlock[], clean: number }}
 */
export function classifyRule9Blocks(blocks, grandfathered) {
  /** @type {TaskBlock[]} */
  const blocking = [];
  /** @type {TaskBlock[]} */
  const grand = [];
  let clean = 0;
  for (const b of blocks) {
    if (b.missingFields.length === 0) {
      clean++;
      continue;
    }
    if (grandfathered.has(b.id)) grand.push(b);
    else blocking.push(b);
  }
  return { blocking, grandfathered: grand, clean };
}

// --------------------------------------------------------------- CLI -------

function main() {
  const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");
  const blocks = parseRule9Blocks(tasksMd);
  const { blocking, grandfathered, clean } = classifyRule9Blocks(blocks, RULE_9_GRANDFATHERED);
  process.stdout.write(
    `rule-9-tasksmd-fields: scanned ${blocks.length} task block(s); clean=${clean}, grandfathered=${grandfathered.length}, blocking=${blocking.length}\n`,
  );
  if (blocking.length === 0) {
    if (grandfathered.length > 0) {
      process.stdout.write(
        `  ${grandfathered.length} grandfathered task(s) (will block when modified or once backfilled — track in TASKS.md \`rule-9-tasksmd-fields-backfill\`)\n`,
      );
    }
    process.exit(0);
    return;
  }
  process.stderr.write(
    `\nrule-9-tasksmd-fields violation: ${blocking.length} non-grandfathered task block(s) missing rule-#9 fields:\n`,
  );
  for (const b of blocking) {
    process.stderr.write(`  ${b.id}: missing ${b.missingFields.join(", ")}\n`);
  }
  process.stderr.write(
    "\nFix: add the missing field(s) to the task block. Each rule-#9 field is iron:\n" +
      "  - **Hypothesis**:    what the change does + how it's expected to move a metric\n" +
      "  - **Success**: <Δ>   (numeric threshold) — OR **Acceptance**: (list of pass conditions)\n" +
      "  - **Pivot**: <Δ>     (numeric threshold below which the approach is abandoned)\n" +
      "  - **Measurement**:   exact runnable command/query that produces the metric\n" +
      "  - **Anchor**:        literature citation / vision.md § / rule #N\n" +
      "If the task is genuinely pre-rule-9 and the metric source doesn't exist yet,\n" +
      "ship a preparation PR first (rule #9 § \"preparation-PR pattern\").\n",
  );
  process.exit(1);
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-9-tasksmd-fields.mjs");
if (isCli) main();
