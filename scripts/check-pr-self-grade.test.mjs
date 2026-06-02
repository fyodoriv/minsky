// Tests for check-pr-self-grade.mjs. Pattern: deterministic gate over a
// PR-body convention (rule #10). Paired positive/negative fixtures
// (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { checkPrSelfGrade, isAlternativeForm } from "./check-pr-self-grade.mjs";

const validBody = [
  "## Summary",
  "Some summary text.",
  "",
  "## Hypothesis self-grade",
  "",
  "- Predicted: feature X improves metric Y by 10%",
  "- Observed: metric Y rose by 12%",
  "- Match: yes",
  "- Lesson: the predicted effect was conservative; threshold can be tightened",
  "",
  "## Test plan",
  "- [x] tests pass",
  "",
].join("\n");

describe("checkPrSelfGrade", () => {
  test("valid PR body with all four fields → ok", () => {
    const result = checkPrSelfGrade(validBody);
    expect(result.ok).toBe(true);
  });

  test("missing header → fails (and reports the missing fields too)", () => {
    const body = "## Summary\nNo self-grade block here.\n";
    const result = checkPrSelfGrade(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/missing.*Hypothesis self-grade/);
  });

  test("missing one field (Observed) → fails", () => {
    const body = validBody.replace(/^- Observed:.*$/m, "");
    const result = checkPrSelfGrade(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Observed"))).toBe(true);
  });

  test("Match value not in {yes,no,partial} → fails", () => {
    const body = validBody.replace("Match: yes", "Match: maybe");
    const result = checkPrSelfGrade(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Match"))).toBe(true);
  });

  test("empty Predicted value → fails", () => {
    const body = validBody.replace(
      "- Predicted: feature X improves metric Y by 10%",
      "- Predicted: ",
    );
    const result = checkPrSelfGrade(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some(
        (e) => e.includes("Predicted") && (e.includes("missing") || e.includes("too short")),
      ),
    ).toBe(true);
  });

  test("Match: partial is accepted", () => {
    const body = validBody.replace("Match: yes", "Match: partial");
    expect(checkPrSelfGrade(body).ok).toBe(true);
  });

  test("Match: no is accepted (failed predictions are valid; that's the point)", () => {
    const body = validBody.replace("Match: yes", "Match: no");
    expect(checkPrSelfGrade(body).ok).toBe(true);
  });

  test("bold / markdown formatting inside fields is tolerated", () => {
    const body = [
      "## Hypothesis self-grade",
      "",
      "- **Predicted**: X improves Y",
      "- **Observed**: Y did improve",
      "- **Match**: yes",
      "- **Lesson**: the call was correct",
      "",
    ].join("\n");
    expect(checkPrSelfGrade(body).ok).toBe(true);
  });

  test("header at any heading depth is accepted (## or ###)", () => {
    const body = [
      "### Hypothesis self-grade",
      "",
      "- Predicted: feature X improves metric Y",
      "- Observed: metric Y rose by 12%",
      "- Match: yes",
      "- Lesson: prediction was conservative",
      "",
    ].join("\n");
    expect(checkPrSelfGrade(body).ok).toBe(true);
  });
});

const altFormBody = [
  "## Summary",
  "Some summary text.",
  "",
  "- **Hypothesis**: extending the lint makes the failure self-explanatory",
  "- **Success**: the next 5 PRs pass on the second push",
  "- **Pivot**: tighten the heuristic to require list bullets",
  "- **Measurement**: count of pr-self-grade failures in 14 days",
  "- **Anchor**: AGENTS.md § Orchestrator discipline rule (2)",
  "",
].join("\n");

describe("checkPrSelfGrade — task-pre-registration form detection", () => {
  test("body with ≥3 task-pre-reg field bullets → isAlternativeForm true", () => {
    expect(isAlternativeForm(altFormBody)).toBe(true);
  });

  test("body with the PR-template form only → isAlternativeForm false", () => {
    expect(isAlternativeForm(validBody)).toBe(false);
  });

  test("alt form (no Predicted) fails with the pointer leading the errors", () => {
    const result = checkPrSelfGrade(altFormBody);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/task-pre-registration form/);
    expect(result.errors[0]).toMatch(/PULL_REQUEST_TEMPLATE\.md/);
  });

  test("only 2 task-pre-reg fields → not detected as alt form, no pointer", () => {
    const body = ["## Summary", "- **Hypothesis**: a claim", "- **Success**: a threshold", ""].join(
      "\n",
    );
    expect(isAlternativeForm(body)).toBe(false);
    const result = checkPrSelfGrade(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /task-pre-registration form/.test(e))).toBe(false);
  });

  test("'Hypothesis:' as embedded prose (not a bullet) does not trigger detection", () => {
    const body = [
      "## Summary",
      "We discussed the Hypothesis: it should work. Also Success: shipped. And Pivot: none.",
      "",
    ].join("\n");
    expect(isAlternativeForm(body)).toBe(false);
  });

  test("a valid PR-template body that happens to mention task-pre-reg fields stays ok", () => {
    const body = [
      ...validBody.split("\n"),
      "Notes:",
      "- **Hypothesis**: see the EXPERIMENT.yaml",
      "- **Success**: green CI",
      "- **Pivot**: revert",
    ].join("\n");
    expect(checkPrSelfGrade(body).ok).toBe(true);
  });
});
