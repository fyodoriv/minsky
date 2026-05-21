#!/usr/bin/env node
// <!-- scope: human-approved closes the devin-spawn-no-pr-opened task (already removed from TASKS.md per the PR description); pairs with the runtime-invariants briefIncludesPrInstructions seam in cross-repo-runner -->
// Pattern: deterministic CI gate over a literal substrate.
// Source: rule #10 (vision.md § 10 — deterministic enforcement);
//   TASKS.md `devin-spawn-no-pr-opened` (the fix shipped in
//   commit 085fdd7 + runner backstop in `runner.ts`); rule #1 (don't
//   reinvent — the same predicate already lives in
//   `novel/cross-repo-runner/src/runtime-invariants.ts`'s
//   `briefIncludesPrInstructions` check, which runs at runtime; this
//   script is its pre-merge counterpart so a regression cannot reach
//   `main`).
// Conformance: full — pure regex over the source file, no LLM, no
//   build artifact dependency, runs in <100ms in CI.
//
// Why this gate exists: the `devin-spawn-no-pr-opened` bug class
// (2026-05-18 live daemon: 3 validated iterations, 0 PRs opened) was
// fixed by adding `gh pr create` / `git push` instructions to the
// spawn brief AND by adding a post-spawn `gh pr create` backstop in
// the runner. Both layers must remain present — removing either one
// silently reopens the bug. This gate enforces the brief layer at
// pre-merge time; the runner backstop is enforced by paired tests in
// `novel/cross-repo-runner/src/runner.test.ts`.
//
// Required substrings inside `renderSystemPromptOverlay` in
// `novel/cross-repo-runner/src/spawn-plan.ts`:
//
//   "FINAL STEP"   — the explicit checklist header that converts the
//                    agent's analysis-mode tail into action-mode
//                    (per spawn-plan.ts § Final-step block comment).
//   "gh pr create" — the PR-creation command the agent must run.
//   "git push"     — the push step that must precede `gh pr create`.
//
// Missing any of these → exit 1 with a pointer to the spawn-plan.ts
// section and the runtime-invariant the gate mirrors. The error
// message names the task ID so an agent picking the regression can
// re-pull the context.
//
// Pivot (rule #9): if the brief's literal text drifts (e.g. operators
// translate the instructions to another language) the gate flips to
// require the runtime-invariant's predicate name (`hasPrInstruction`)
// and stops scanning raw text. Until that pivot, the literal check
// is the single source of truth.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SPAWN_PLAN_PATH = resolve(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts");

/**
 * The literal substrings the spawn brief MUST contain. Order matches the
 * `renderSystemPromptOverlay` final-step block in `spawn-plan.ts`:
 * `FINAL STEP` header, then the `git push` + `gh pr create` shell snippet.
 */
export const REQUIRED_BRIEF_SUBSTRINGS = Object.freeze(["FINAL STEP", "git push", "gh pr create"]);

/**
 * Pure check: given the spawn-plan source text, return either
 * `{ ok: true }` or `{ ok: false, missing: string[] }`.
 *
 * @param {string} spawnPlanSource
 * @returns {{ ok: true } | { ok: false, missing: readonly string[] }}
 */
export function checkBriefPrInstructions(spawnPlanSource) {
  const missing = REQUIRED_BRIEF_SUBSTRINGS.filter((token) => !spawnPlanSource.includes(token));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * CLI: reads `novel/cross-repo-runner/src/spawn-plan.ts` and reports.
 *
 * @returns {number}
 */
function main() {
  let source;
  try {
    source = readFileSync(SPAWN_PLAN_PATH, "utf8");
  } catch (err) {
    process.stderr.write(
      `check-brief-pr-instructions: cannot read ${SPAWN_PLAN_PATH}: ${String(err)}\n`,
    );
    return 1;
  }
  const result = checkBriefPrInstructions(source);
  if (result.ok) {
    process.stdout.write(
      `check-brief-pr-instructions: OK — all ${REQUIRED_BRIEF_SUBSTRINGS.length} required substrings present in spawn-plan.ts.\n`,
    );
    return 0;
  }
  process.stderr.write(
    [
      "check-brief-pr-instructions: violation in novel/cross-repo-runner/src/spawn-plan.ts",
      "",
      "Missing required substring(s) the spawn brief must include:",
      ...result.missing.map((token) => `  - "${token}"`),
      "",
      "These literals are the brief's PR-creation contract (TASKS.md",
      "`devin-spawn-no-pr-opened` — fix shipped 2026-05-18 in commit",
      "085fdd7; runtime-invariant counterpart:",
      "`briefIncludesPrInstructions` in",
      "novel/cross-repo-runner/src/runtime-invariants.ts).",
      "",
      "Restore them inside `renderSystemPromptOverlay` so the spawned",
      "agent receives an explicit `git push` + `gh pr create` step.",
      "Without them, validated iterations leave pr_url=null and the",
      "task gets re-picked forever (the original bug class).",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-brief-pr-instructions.mjs");
if (invokedDirectly) {
  process.exit(main());
}
