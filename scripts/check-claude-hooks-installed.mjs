#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved Tier 1 hook substrate ratchet per det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse (PR #911 task block removed at merge time) -->
//
// check-claude-hooks-installed — verifies the Tier 1 hook substrate exists.
//
// Per `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`,
// Minsky ships a project-level `.claude/settings.json` + per-event hook
// scripts under `.claude/hooks/` that run the deterministic-enforcement
// stack INSIDE the agent's loop (not just at git boundaries).
//
// This meta-lint fails if a future PR removes any of those files or
// silently misconfigures them. Same shape as the agentbrew-hooks-decommission
// ratchet (vision.md rule #10 — when a deterministic linter ships, any
// prior Skill-based enforcement is removed AND the new substrate is pinned
// against regression).
//
// Pattern: pure manifest + I/O seam injection (rule #2). The required-files
// list is a const at the top; the FS reader is injected via `opts` for
// testability. Conformance: full.
//
// Source: TASKS.md `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`;
// vision rule #10 (deterministic enforcement); Sitnik 2026 (Evil Martians
// "Stop writing rules in AGENTS.md"); Anthropic 2026 (Claude Code hooks
// reference, code.claude.com/docs/en/hooks).

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Files required for Tier 1 to function. If any is missing or
 * (for scripts) not executable, the lint fails.
 *
 * @type {Array<{ path: string; kind: "json" | "script" }>}
 */
const REQUIRED_FILES = [
  { path: ".claude/settings.json", kind: "json" },
  { path: ".claude/hooks/post-edit.sh", kind: "script" },
  { path: ".claude/hooks/stop-gate.sh", kind: "script" },
  { path: ".claude/hooks/block-dangerous-bash.sh", kind: "script" },
];

/**
 * Required keys in the parsed `.claude/settings.json` `hooks` object.
 * Each maps to the event name + a matcher pattern we expect.
 *
 * @type {Array<{ event: string; matcher?: string }>}
 */
const REQUIRED_HOOK_EVENTS = [
  { event: "PostToolUse", matcher: "Write|Edit|MultiEdit" },
  { event: "PreToolUse", matcher: "Bash" },
  { event: "Stop" },
];

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]      override the repo-root resolver (tests)
 * @property {(p: string) => boolean} [fileExists]   override the existence check (tests)
 * @property {(p: string) => boolean} [fileExecutable] override the executable-bit check (tests)
 * @property {(p: string) => string} [readText]      override the read (tests)
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 */

/**
 * Pure-ish check function. I/O lives behind the `opts` seams.
 *
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkClaudeHooksInstalled(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const fileExists = opts.fileExists ?? defaultFileExists;
  const fileExecutable = opts.fileExecutable ?? defaultFileExecutable;
  const readText = opts.readText ?? defaultReadText;

  /** @type {string[]} */
  const violations = [];

  checkRequiredFiles(repoRoot, fileExists, fileExecutable, violations);

  const settingsPath = `${repoRoot}/.claude/settings.json`;
  if (fileExists(settingsPath)) {
    checkSettingsShape(readText(settingsPath), violations);
  }

  return finalize(violations);
}

/**
 * Pass 1: every required file in REQUIRED_FILES exists. Hook scripts
 * additionally must have the user-executable bit set.
 *
 * @param {string} repoRoot
 * @param {(p: string) => boolean} fileExists
 * @param {(p: string) => boolean} fileExecutable
 * @param {string[]} violations  mutated in place
 */
function checkRequiredFiles(repoRoot, fileExists, fileExecutable, violations) {
  for (const { path, kind } of REQUIRED_FILES) {
    const full = `${repoRoot}/${path}`;
    if (!fileExists(full)) {
      violations.push(
        `missing: ${path} (Tier 1 ${kind} required per det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse)`,
      );
      continue;
    }
    if (kind === "script" && !fileExecutable(full)) {
      violations.push(
        `not executable: ${path} (hook scripts must have +x; run \`chmod +x ${path}\`)`,
      );
    }
  }
}

/**
 * Pass 2: settings.json parses + has the expected `hooks` object with
 * required event entries and matchers.
 *
 * @param {string} text   raw settings.json contents
 * @param {string[]} violations  mutated in place
 */
function checkSettingsShape(text, violations) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    violations.push(
      `invalid JSON in .claude/settings.json: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    violations.push(".claude/settings.json must be a JSON object at the top level");
    return;
  }

  const hooks = /** @type {Record<string, unknown>} */ (parsed)["hooks"];
  if (typeof hooks !== "object" || hooks === null) {
    violations.push(".claude/settings.json missing `hooks` object");
    return;
  }

  const hooksObj = /** @type {Record<string, unknown>} */ (hooks);
  for (const { event, matcher } of REQUIRED_HOOK_EVENTS) {
    checkHookEvent(hooksObj, event, matcher, violations);
  }
}

/**
 * Check a single event's entries: presence, matcher, and command shape.
 *
 * @param {Record<string, unknown>} hooksObj
 * @param {string} event
 * @param {string | undefined} matcher
 * @param {string[]} violations
 */
function checkHookEvent(hooksObj, event, matcher, violations) {
  const entries = hooksObj[event];
  if (!Array.isArray(entries) || entries.length === 0) {
    violations.push(
      `.claude/settings.json missing hooks[${event}] entry (Tier 1 requires PostToolUse + PreToolUse + Stop)`,
    );
    return;
  }
  if (matcher && !hasMatcher(entries, matcher)) {
    violations.push(
      `.claude/settings.json hooks[${event}] missing matcher "${matcher}" (Tier 1 requires this exact matcher)`,
    );
  }
  for (const entry of entries) {
    checkEntryCommands(entry, event, violations);
  }
}

/**
 * @param {unknown[]} entries
 * @param {string} matcher
 * @returns {boolean}
 */
function hasMatcher(entries, matcher) {
  return entries.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const m = /** @type {Record<string, unknown>} */ (entry)["matcher"];
    return typeof m === "string" && m === matcher;
  });
}

/**
 * @param {unknown} entry
 * @param {string} event
 * @param {string[]} violations
 */
function checkEntryCommands(entry, event, violations) {
  if (typeof entry !== "object" || entry === null) return;
  const inner = /** @type {Record<string, unknown>} */ (entry)["hooks"];
  if (!Array.isArray(inner)) return;
  for (const cmd of inner) {
    if (typeof cmd !== "object" || cmd === null) continue;
    const command = /** @type {Record<string, unknown>} */ (cmd)["command"];
    if (typeof command !== "string" || command.length === 0) {
      violations.push(`.claude/settings.json hooks[${event}] entry has empty command field`);
    }
  }
}

/**
 * @param {string[]} violations
 * @returns {CheckResult}
 */
function finalize(violations) {
  return { ok: violations.length === 0, violations };
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function defaultFileExists(path) {
  return existsSync(path);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function defaultFileExecutable(path) {
  try {
    const st = statSync(path);
    // Check user-executable bit (0o100).
    return (st.mode & 0o100) !== 0;
  } catch {
    return false;
  }
}

/**
 * @param {string} path
 * @returns {string}
 */
function defaultReadText(path) {
  return readFileSync(path, "utf8");
}

// CLI entry — only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkClaudeHooksInstalled();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-claude-hooks-installed: violations found:");
  for (const v of result.violations) {
    console.error(`  - ${v}`);
  }
  console.error("");
  console.error(
    "Fix: see TASKS.md `det-tier1-hook-infrastructure-claude-code-stop-and-posttooluse`",
  );
  console.error("     or run the recovery script (TODO once landed).");
  process.exit(1);
}
