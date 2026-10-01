// Paired tests for `check-brief-pr-instructions.mjs`. Pattern: rule #10
// deterministic gate; xUnit paired fixtures (Meszaros 2007). The pure
// function is the unit; the CLI's filesystem read is exercised by the
// "the live build_brief.py file passes the gate today" sentinel below
// (the only test that touches a real path — the rest inject fixtures).
//
// History: PR #881 (phase-7b step 5) migrated the live-file pointer
// from `novel/cross-repo-runner/src/spawn-plan.ts` (TS, deletion
// target) to `scripts/build_brief.py` (Python, canonical bash-runner
// brief builder). Same 3 required substrings; same contract.
//
// Source: TASKS.md `devin-spawn-no-pr-opened`; rule #10 (vision.md § 10 —
// deterministic enforcement; pure-function + CLI-wrapper split).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  checkBriefPrInstructions,
  REQUIRED_BRIEF_SUBSTRINGS,
} from "./check-brief-pr-instructions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BUILD_BRIEF_PATH = resolve(REPO_ROOT, "scripts", "build_brief.py");

describe("checkBriefPrInstructions — pure function", () => {
  test("ok when every required substring is present", () => {
    const source = [
      "function renderSystemPromptOverlay() {",
      '  return ["FINAL STEP", "git push", "gh pr create"].join("\\n");',
      "}",
    ].join("\n");
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(true);
  });

  test("violation when FINAL STEP is missing", () => {
    const source = ['"git push"; "gh pr create";'].join("\n");
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("FINAL STEP");
  });

  test("violation when git push is missing", () => {
    const source = ['"FINAL STEP"; "gh pr create";'].join("\n");
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("git push");
  });

  test("violation when gh pr create is missing", () => {
    const source = ['"FINAL STEP"; "git push -u origin HEAD";'].join("\n");
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("gh pr create");
  });

  test("violation lists every missing substring (not just the first)", () => {
    const source = "// brief without the required block";
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...result.missing].sort()).toEqual([...REQUIRED_BRIEF_SUBSTRINGS].sort());
  });

  test("substring check is literal — case-sensitive, no regex", () => {
    // "Final Step" (wrong case) and "gh PR create" (wrong case) should
    // both fail — the brief contract is exact, no fuzz tolerance.
    const source = '"Final Step"; "git push"; "gh PR create";';
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain("FINAL STEP");
    expect(result.missing).toContain("gh pr create");
  });

  test("substrings can appear in any order — only presence matters", () => {
    const source = '"git push -u origin HEAD"; "FINAL STEP after"; "Then run gh pr create"';
    const result = checkBriefPrInstructions(source);
    expect(result.ok).toBe(true);
  });
});

// Sentinel: pin the production build_brief.py to the gate. If someone
// edits the brief in a way that drops one of the required substrings,
// this test goes red before CI does. Decouples the contract from the
// CI wiring — failing locally is the cheapest feedback loop.
describe("checkBriefPrInstructions — live build_brief.py", () => {
  test("the production scripts/build_brief.py passes the gate today", () => {
    const source = readFileSync(BUILD_BRIEF_PATH, "utf8");
    const result = checkBriefPrInstructions(source);
    if (!result.ok) {
      throw new Error(
        `live build_brief.py is missing required brief substrings: ${result.missing.join(", ")}. This is the devin-spawn-no-pr-opened regression — restore the substrings inside render_system_prompt_overlay.`,
      );
    }
    expect(result.ok).toBe(true);
  });
});
