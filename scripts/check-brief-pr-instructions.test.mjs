// Paired tests for `check-brief-pr-instructions.mjs`. Pattern: rule #10
// deterministic gate; xUnit paired fixtures (Meszaros 2007). The pure
// function is the unit; the CLI's filesystem read is exercised by the
// "the live spawn-plan.ts file passes the gate today" sentinel below
// (the only test that touches a real path — the rest inject fixtures).
//
// Source: TASKS.md `devin-spawn-no-pr-opened`; rule #10 (vision.md § 10 —
// deterministic enforcement; pure-function + CLI-wrapper split).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  REQUIRED_BRIEF_SUBSTRINGS,
  checkBriefPrInstructions,
} from "./check-brief-pr-instructions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SPAWN_PLAN_PATH = resolve(REPO_ROOT, "novel", "cross-repo-runner", "src", "spawn-plan.ts");

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

// Sentinel: pin the production spawn-plan.ts to the gate. If someone
// edits the brief in a way that drops one of the required substrings,
// this test goes red before CI does. Decouples the contract from the
// CI wiring — failing locally is the cheapest feedback loop.
describe("checkBriefPrInstructions — live spawn-plan.ts", () => {
  test("the production novel/cross-repo-runner/src/spawn-plan.ts passes the gate today", () => {
    const source = readFileSync(SPAWN_PLAN_PATH, "utf8");
    const result = checkBriefPrInstructions(source);
    if (!result.ok) {
      throw new Error(
        `live spawn-plan.ts is missing required brief substrings: ${result.missing.join(", ")}. This is the devin-spawn-no-pr-opened regression — restore the substrings inside renderSystemPromptOverlay.`,
      );
    }
    expect(result.ok).toBe(true);
  });
});
