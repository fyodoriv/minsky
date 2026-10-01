// Tests for check-pr-security-review.mjs. Pattern: deterministic gate over a
// PR-body convention (rule #10). Paired positive/negative fixtures (Meszaros
// 2007). Sibling: scripts/check-pr-self-grade.test.mjs.

import { describe, expect, test } from "vitest";

import { checkPrSecurityReview } from "./check-pr-security-review.mjs";

const validBodyWithSection = [
  "## Summary",
  "Some summary text.",
  "",
  "## Security & privacy",
  "",
  "No new attack surface; vision.md § 13 minimum-bar items reviewed.",
  "Reads no new files; writes no new files; binds no new ports.",
  "",
  "## Test plan",
  "- [x] tests pass",
  "",
].join("\n");

describe("checkPrSecurityReview", () => {
  test("section heading `## Security & privacy` → ok", () => {
    const result = checkPrSecurityReview(validBodyWithSection);
    expect(result.ok).toBe(true);
  });

  test("section heading at any depth (### / ####) → ok", () => {
    const body = ["### Security & privacy", "", "Reviewed.", ""].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test('inline phrase "Security and privacy" (ASCII variant) → ok', () => {
    const body = [
      "## Summary",
      "Doc-only change. Security and privacy implications: none.",
      "",
    ].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("case-insensitive header match (`## SECURITY & PRIVACY`) → ok", () => {
    const body = ["## SECURITY & PRIVACY", "", "Reviewed.", ""].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("typed opt-out with em-dash separator → ok", () => {
    const body = [
      "## Summary",
      "Pure typo fix.",
      "",
      "<!-- security: not-applicable — typo fix in vision.md prose -->",
      "",
    ].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("typed opt-out with ASCII `--` separator → ok", () => {
    const body = ["<!-- security: not-applicable -- vendor lockfile bump only -->", ""].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("body with neither marker nor opt-out → fails", () => {
    const body = ["## Summary", "Some change.", "", "## Test plan", "- [x] tests pass", ""].join(
      "\n",
    );
    const result = checkPrSecurityReview(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/security & privacy/i);
  });

  test("opt-out present but reason missing (raw `not-applicable -- -->`) → fails", () => {
    const body = "<!-- security: not-applicable -- -->\n";
    const result = checkPrSecurityReview(body);
    expect(result.ok).toBe(false);
  });

  test("opt-out present but reason too short (`-- ab -->`) → fails", () => {
    const body = "<!-- security: not-applicable -- ab -->\n";
    const result = checkPrSecurityReview(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/too short/);
  });

  test("opt-out reason exactly 3 chars → ok (boundary condition)", () => {
    const body = "<!-- security: not-applicable -- abc -->\n";
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("section AND opt-out both present → ok (section wins; opt-out is ignored)", () => {
    const body = [
      "## Security & privacy",
      "Reviewed.",
      "",
      "<!-- security: not-applicable -- redundant -->",
      "",
    ].join("\n");
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("phrase appearing only as part of unrelated word → still triggers (substring match is intentional)", () => {
    // The current implementation does a `\bsecurity\s+(?:&|and)\s+privacy\b`
    // word-boundary match, so "Security and Privacy Officer" passes — that is
    // the desired behaviour. A reviewer mentioning the role IS a security &
    // privacy review marker, even if rambling.
    const body = "We discussed this with the Security and Privacy Officer.\n";
    expect(checkPrSecurityReview(body).ok).toBe(true);
  });

  test("empty body → fails", () => {
    const result = checkPrSecurityReview("");
    expect(result.ok).toBe(false);
  });
});
