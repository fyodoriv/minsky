#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-touches-field-strict-mode-flip-lenient-default (PR #911) -->
//
// check-touches-field — every P0/P1 task block in TASKS.md must carry
// `**Touches**:` declaring the file globs the task is expected to edit.
// Tasks without a Touches field cannot be parallelised safely — the
// daemon's collision check needs the glob set to refuse colliding
// concurrent claims.
//
// Per AGENTS.md §"`**Touches**:` field on task blocks": "strict by
// default — `<none>` to explicitly opt out". This flips the lenient
// default that was documented as "future policy choice".
//
// Ratchet model (same shape as rule-9-tasksmd-fields,
// competitive-goal, adapter-conventions): existing P0/P1 violators
// captured in `TOUCHES_GRANDFATHERED` at lint introduction; NEW tasks
// MUST carry `**Touches**:` OR be added to the allowlist with a
// documented reason. As tasks are completed or backfilled, the
// allowlist drains.
//
// Note: the daemon-side collision check (`novel/tick-loop/src/
// touches-glob.ts`) was deleted in phase-11b (commit d90eda7) along
// with the rest of the tick-loop module. This lint is the only
// remaining surface where the Touches field has teeth — without it,
// the field becomes inert documentation. The lint preserves the
// field's value for the M2 parallel-daemon work even though the
// runtime check no longer exists in main.
//
// Anchors: AGENTS.md §"`**Touches**:` field on task blocks"; vision
// rule #10 (deterministic enforcement) + rule #16 (default by default).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Grandfathered P0/P1 task IDs that lack `**Touches**:` as of lint
 * introduction (2026-05-27). Goal: drain to empty as tasks are
 * completed or backfilled with the field. NEW tasks added after this
 * lint ships MUST NOT be added to this set — they must declare
 * `**Touches**: <globs>` or `**Touches**: <none>` (explicit opt-out).
 *
 * @type {ReadonlySet<string>}
 */
export const TOUCHES_GRANDFATHERED = new Set([
  "minsky-persona-rule-decommissioning-post-hooks",
  "cli-consolidate-pnpm-minsky-scripts",
  "cli-consolidation-lint-prevents-regression",
  "minsky-npm-publish-v0-1-0",
  "regression-test-no-git-checkout-against-host",
  "minsky-human-comm-via-file",
  "agents-can-self-heal-minsky-m1-13",
  "minsky-init-one-command-bootstrap",
  "minsky-uninstall-clean-removal",
  "minsky-default-8h-repo-transformation",
  "readme-rewrite-5-min-install-guide",
  "minsky-remote-task-submission",
  "fleet-stability-centralized-reporting",
  "interactive-model-cost-picker",
  "fleet-log-aggregation",
  "minsky-on-minsky-as-regular-host",
  "orchestrator-must-land-local-vetted-branches",
  "devin-spawn-missing-permission-mode-bypass",
  "cloud-agent-spawn-argv-regression-matrix",
  "cloud-agent-iteration-record-parity-matrix",
  "cloud-agent-config-and-host-feature-matrix-audit",
  "path-a-phase-7-cross-repo-runner-shell-rewrite",
  "path-a-phase-8-tick-observer-spec-monitor-inline-fold",
  "path-a-phase-9-small-package-sweep-delete",
  "path-a-phase-10-competitive-benchmark-static",
  "path-a-phase-11-sidecar-template-only",
  "path-a-phase-13-identity-promotion",
  "phase-7b-delete-cross-repo-runner-multistep",
  "phase-11b-delete-tick-loop-multistep",
  "competitor-add-auto-code-rover",
  "competitor-add-pr-agent",
  "competitor-deepen-cursor-agent",
  "competitor-add-autogpt",
  "competitor-add-open-interpreter",
  "competitor-add-continue-dev",
  "competitor-deepen-ralph-wiggum-official",
  "competitor-deepen-codex-cli",
  "competitor-deepen-openhands",
  "daemon-silent-on-claude-account-rate-limit",
  "competitor-add-factory",
  "competitor-add-smol-developer",
  "competitor-add-gpt-engineer",
  "competitor-add-continuous-claude",
  "competitor-deepen-goose",
  "competitor-deepen-langgraph",
  "competitor-deepen-omc",
  "devin-per-worker-isolation-primitive",
  "competitor-deepen-swe-agent",
  "watchdog-timeout-kills-productive-devin",
  "competitor-deepen-microsoft-agent-framework",
  "competitor-add-babyagi",
  "competitor-add-pydantic-ai",
  "competitor-add-roo-code",
  "minsky-config-json-support-local-llm-pref",
  "competitor-deepen-metagpt",
  "competitor-deepen-composio-ao",
  "competitor-add-devika",
  "competitor-deepen-cline",
  "competitor-add-refact-ai",
  "competitor-deepen-agentless",
  "competitor-deepen-crewai",
  "competitor-deep-dive-wave-2026-05-24",
  "competitor-deepen-devin",
  "competitor-add-plandex",
  "minsky-repo-git-config-bare-misset",
  "competitor-add-smolagents",
  "competitor-deepen-aider",
  "competitor-deepen-claude-agent-sdk",
  "competitor-add-sweep",
  "gh-actions-checkout-v4-flaky-auth-failures",
  "readme-honest-3-developer-user-test",
  "m1-retag-v0-1-0-after-completion",
  "cto-audit-merge-rate-metric",
  "graphql-repo-slug-mismatch-non-fatal",
  "daemon-log-lacks-iteration-detail",
  "observer-launchd-exits-on-nonzero",
  "orchestrator-gh-graphql-401-token-source-divergence",
  "tick-loop-transient-gh-401-must-not-crash-daemon",
  "task-aware-model-router",
  "daemon-iteration-phase-tagged-spans",
  "daemon-config-analyzer-auto-apply",
  "daemon-launchd-drift-warning-suppress-when-cli-launched",
  "daemon-brief-test-pin-soft-tolerance",
  "omc-tasksmd-issue",
  "minsky-daemon-plist-multi-host",
  "daemon-daily-metrics-render-not-firing",
  "milestone-alignment-fill-gaps-m1",
  "local-gate-merge-false-negative-on-worktree-bound-branch-delete",
  "local-gate-merge-minsky-home-hardcoded-path",
  "brief-mandates-task-block-removal-on-shipped-work",
  "host-loop-spawn-failed-retry-budget",
  "spawn-strategy-pre-sigkill-stash",
]);

/**
 * @typedef {object} TaskBlock
 * @property {string} id
 * @property {string} section  e.g. "P0", "P1", "P2", "P3"
 * @property {string} body
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [tasksMdPath]
 * @property {string} [tasksMdContent]
 */

/**
 * Parse TASKS.md and yield every P0/P1 task block with its body text.
 *
 * @param {string} src
 * @returns {TaskBlock[]}
 */
export function parseP0P1Blocks(src) {
  /** @type {TaskBlock[]} */
  const blocks = [];
  /** @type {{ section: string | null, current: TaskBlock | null }} */
  const state = { section: null, current: null };
  for (const line of src.split("\n")) {
    processLine(line, blocks, state);
  }
  if (state.current !== null) blocks.push(state.current);
  return blocks;
}

/**
 * Single-line processor for parseP0P1Blocks. Mutates `state` and
 * `blocks` in place. Extracted to keep parseP0P1Blocks under the
 * cognitive-complexity limit (rule via biome's
 * `noExcessiveCognitiveComplexity` at 10).
 *
 * @param {string} line
 * @param {TaskBlock[]} blocks
 * @param {{ section: string | null, current: TaskBlock | null }} state
 */
function processLine(line, blocks, state) {
  const sectionMatch = /^##\s+(P[0-3])\b/.exec(line);
  if (sectionMatch !== null) {
    flushCurrent(blocks, state);
    state.section = sectionMatch[1] ?? null;
    return;
  }
  if (state.section !== "P0" && state.section !== "P1") return;
  const headMatch = /^- \[ \] `([^`]+)`/.exec(line);
  if (headMatch !== null && headMatch[1] !== undefined) {
    flushCurrent(blocks, state);
    state.current = {
      id: headMatch[1],
      section: state.section,
      body: `${line}\n`,
    };
    return;
  }
  if (state.current !== null) {
    state.current.body += `${line}\n`;
  }
}

/**
 * @param {TaskBlock[]} blocks
 * @param {{ current: TaskBlock | null }} state
 */
function flushCurrent(blocks, state) {
  if (state.current !== null) {
    blocks.push(state.current);
    state.current = null;
  }
}

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkTouchesField(opts = {}) {
  const path = opts.tasksMdPath ?? `${REPO_ROOT}/TASKS.md`;
  const src = opts.tasksMdContent ?? readFileSync(path, "utf8");
  const blocks = parseP0P1Blocks(src);
  /** @type {string[]} */
  const violations = [];

  for (const block of blocks) {
    if (block.body.includes("**Touches**:")) continue;
    if (TOUCHES_GRANDFATHERED.has(block.id)) continue;
    violations.push(
      `${block.id} (${block.section}): missing \`**Touches**:\` field. Per AGENTS.md §"\`**Touches**:\` field on task blocks" (strict by default). Add \`**Touches**: <comma-separated globs>\` OR \`**Touches**: <none>\` to opt out explicitly.`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    scannedCount: blocks.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkTouchesField();
  if (result.ok) {
    process.exit(0);
  }
  console.error(`check-touches-field: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: add `**Touches**: <comma-separated globs>` to the task block (or `**Touches**: <none>` for cross-cutting tasks that don't fit a glob).",
  );
  process.exit(1);
}
