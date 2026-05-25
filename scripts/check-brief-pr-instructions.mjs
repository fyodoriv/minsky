#!/usr/bin/env node
// <!-- scope: human-approved phase-7b-delete-cross-repo-runner-multistep step 5 — migrates this lint from `novel/cross-repo-runner/src/spawn-plan.ts` (TS, deletion target) to `scripts/build_brief.py` (Python, canonical bash-runner brief builder). Same 3 required substrings; same contract. -->
// Pattern: deterministic CI gate over a literal substrate.
// Source: rule #10 (vision.md § 10 — deterministic enforcement);
//   TASKS.md `devin-spawn-no-pr-opened` (the fix shipped in
//   commit 085fdd7 + runner backstop in `runner.ts`); rule #1 (don't
//   reinvent — the same predicate previously lived in
//   `novel/cross-repo-runner/src/runtime-invariants.ts`'s
//   `briefIncludesPrInstructions` check, now superseded by the bash
//   runner's own brief-building path via `scripts/build_brief.py`).
// Conformance: full — pure substring scan over the source file, no
//   LLM, no build artifact dependency, runs in <100ms in CI.
//
// Why this gate exists: the `devin-spawn-no-pr-opened` bug class
// (2026-05-18 live daemon: 3 validated iterations, 0 PRs opened) was
// fixed by adding `gh pr create` / `git push` instructions to the
// spawn brief AND by adding a post-spawn `gh pr create` backstop in
// the runner. Both layers must remain present — removing either one
// silently reopens the bug. This gate enforces the brief layer at
// pre-merge time.
//
// As of PR #881 (phase-7b step 5) this lint reads
// `scripts/build_brief.py` — the Python brief builder that the bash
// runner (`bin/minsky-run.sh`) drives via subprocess. The Python
// `render_system_prompt_overlay()` function is the canonical brief
// shape; the TS `renderSystemPromptOverlay()` in spawn-plan.ts is
// being deleted along with the rest of `novel/cross-repo-runner/`.
//
// Required substrings inside `render_system_prompt_overlay` in
// `scripts/build_brief.py`:
//
//   "FINAL STEP"   — the explicit checklist header that converts the
//                    agent's analysis-mode tail into action-mode.
//   "gh pr create" — the PR-creation command the agent must run.
//   "git push"     — the push step that must precede `gh pr create`.
//
// Missing any of these → exit 1 with a pointer to build_brief.py
// and the task ID an agent can re-pull for context.
//
// Pivot (rule #9): if the brief's literal text drifts (e.g. operators
// translate the instructions to another language) the gate flips to
// require a marker name in the source instead of the literal text.
// Until that pivot, the literal check is the single source of truth.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BUILD_BRIEF_PATH = resolve(REPO_ROOT, "scripts", "build_brief.py");

/**
 * The literal substrings the spawn brief MUST contain. Order matches the
 * `render_system_prompt_overlay` final-step block in `build_brief.py`:
 * `FINAL STEP` header, then the `git push` + `gh pr create` shell snippet.
 */
export const REQUIRED_BRIEF_SUBSTRINGS = Object.freeze(["FINAL STEP", "git push", "gh pr create"]);

/**
 * Pure check: given the brief-builder source text, return either
 * `{ ok: true }` or `{ ok: false, missing: string[] }`.
 *
 * @param {string} briefBuilderSource
 * @returns {{ ok: true } | { ok: false, missing: readonly string[] }}
 */
export function checkBriefPrInstructions(briefBuilderSource) {
  const missing = REQUIRED_BRIEF_SUBSTRINGS.filter((token) => !briefBuilderSource.includes(token));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * CLI: reads `scripts/build_brief.py` and reports.
 *
 * @returns {number}
 */
function main() {
  let source;
  try {
    source = readFileSync(BUILD_BRIEF_PATH, "utf8");
  } catch (err) {
    process.stderr.write(
      `check-brief-pr-instructions: cannot read ${BUILD_BRIEF_PATH}: ${String(err)}\n`,
    );
    return 1;
  }
  const result = checkBriefPrInstructions(source);
  if (result.ok) {
    process.stdout.write(
      `check-brief-pr-instructions: OK — all ${REQUIRED_BRIEF_SUBSTRINGS.length} required substrings present in build_brief.py.\n`,
    );
    return 0;
  }
  process.stderr.write(
    [
      "check-brief-pr-instructions: violation in scripts/build_brief.py",
      "",
      "Missing required substring(s) the spawn brief must include:",
      ...result.missing.map((token) => `  - "${token}"`),
      "",
      "These literals are the brief's PR-creation contract (TASKS.md",
      "`devin-spawn-no-pr-opened` — fix shipped 2026-05-18 in commit",
      "085fdd7; bash runner `bin/minsky-run.sh` drives build_brief.py",
      "via subprocess to render the spawn overlay).",
      "",
      "Restore them inside `render_system_prompt_overlay` so the spawned",
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
