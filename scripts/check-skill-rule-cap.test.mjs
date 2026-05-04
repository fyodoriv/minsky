// Tests for check-skill-rule-cap.mjs. Pattern: deterministic gate over an
// advisory-Skill scope cap (rule #10 ratchet applied to the Skill itself).
// Paired positive/negative fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { checkSkillRuleCap } from "./check-skill-rule-cap.mjs";

const MAX = 5;

/**
 * Helper: build a SKILL.md-shaped buffer with `n` `### A<i>.` headings.
 * Mirrors the heading shape used by the live `novel/spec-monitor/SKILL.md`.
 *
 * @param {number} n
 * @returns {string}
 */
function buildSkillWithRules(n) {
  const header = "# spec-monitor\n\nIntro paragraph.\n\n## Residual judgement scope\n\n";
  const rules = [];
  for (let i = 1; i <= n; i += 1) {
    rules.push(`### A${i}. Rule ${i} title\n\nBody text for rule ${i}.\n`);
  }
  return header + rules.join("\n");
}

describe("checkSkillRuleCap", () => {
  test("0 rules (retired Skill) → pass", () => {
    const result = checkSkillRuleCap({
      skillContent: "# spec-monitor\n\nThis Skill has been retired.\n",
      maxRules: MAX,
    });
    expect(result.ruleCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("3 rules → pass (under cap)", () => {
    const result = checkSkillRuleCap({ skillContent: buildSkillWithRules(3), maxRules: MAX });
    expect(result.ruleCount).toBe(3);
    expect(result.violation).toBeNull();
  });

  test("5 rules → pass (at cap)", () => {
    const result = checkSkillRuleCap({ skillContent: buildSkillWithRules(5), maxRules: MAX });
    expect(result.ruleCount).toBe(5);
    expect(result.violation).toBeNull();
  });

  test("6 rules → fail (over cap, violation message names the count + cap)", () => {
    const result = checkSkillRuleCap({ skillContent: buildSkillWithRules(6), maxRules: MAX });
    expect(result.ruleCount).toBe(6);
    expect(result.violation).not.toBeNull();
    expect(result.violation).toContain("6");
    expect(result.violation).toContain("5");
    expect(result.violation).toMatch(/rule-#10 ratchet/);
  });

  test("missing file (null content) → pass (retired Skill, rule-#10 terminal state)", () => {
    const result = checkSkillRuleCap({ skillContent: null, maxRules: MAX });
    expect(result.ruleCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("empty string → pass (treated identically to missing file)", () => {
    const result = checkSkillRuleCap({ skillContent: "", maxRules: MAX });
    expect(result.ruleCount).toBe(0);
    expect(result.violation).toBeNull();
  });

  test("the live novel/spec-monitor/SKILL.md (≤5 rules) passes the gate", async () => {
    // Reads the real file from disk so this test would catch in-repo drift
    // past the cap before CI does. The exact rule count is the
    // load-bearing-against-cap-only invariant — the deterministic ratchet
    // (rule #10) retires individual A<N> rules as they are promoted to CI
    // lints (e.g. A4 → `scripts/check-measurement-inspects-output.mjs`),
    // so the rule count strictly decreases over time. The gate is the
    // upper bound, not the equality.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "..", "novel", "spec-monitor", "SKILL.md");
    const skillContent = await readFile(path, "utf8");
    const result = checkSkillRuleCap({ skillContent, maxRules: MAX });
    expect(result.ruleCount).toBeLessThanOrEqual(MAX);
    expect(result.violation).toBeNull();
  });

  test("non-rule headings (### Output format etc.) are NOT counted", () => {
    const skillContent = [
      "# spec-monitor",
      "",
      "## Residual judgement scope",
      "",
      "### A1. Real rule",
      "Body.",
      "",
      "### Output format",
      "This is a section heading, not a rule heading — must not be counted.",
      "",
      "### A2. Second real rule",
      "Body.",
      "",
      "## Hard cap on scope",
      "",
      "### Some sub-section that mentions A1 in prose",
      "Should not be counted because the heading shape is different.",
    ].join("\n");
    const result = checkSkillRuleCap({ skillContent, maxRules: MAX });
    expect(result.ruleCount).toBe(2);
    expect(result.violation).toBeNull();
  });
});
