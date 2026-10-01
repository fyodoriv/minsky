// Paired tests for `check-vision-rule-13-non-task-anchors.mjs`. Pattern:
// deterministic gate over vision.md § 13 minimum-bar items 7 (Privacy by
// default) and 8 (Threat model per novel/* package) — the two items whose
// load-bearing citation is an industry-standard name (GDPR Art. 25, OWASP
// Privacy Top 10, STRIDE) rather than a sibling P0 task ID.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  checkVisionRule13NonTaskAnchors,
  REQUIRED_ANCHORS,
} from "./check-vision-rule-13-non-task-anchors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Build a minimal rule-#13 fixture with items 1-8 where items 7 and 8 carry
 * the supplied anchor strings. Items 1-6 are placeholders — this gate ignores
 * them (they're the responsibility of `check-vision-rule-13-task-id-citations`).
 *
 * @param {{ item7?: string, item8?: string }} [overrides]
 * @returns {string}
 */
function fixtureSection(overrides = {}) {
  const item7 =
    overrides.item7 ??
    '7. **Privacy by default** — neutral prose. Industry standard: GDPR Article 25 "data protection by design"; OWASP Privacy Top 10.';
  const item8 =
    overrides.item8 ??
    "8. **Threat model per package** — neutral prose. Industry standard: STRIDE (Microsoft Threat Modeling Tool).";
  return [
    "## Some prior section",
    "",
    "### 13. Security & privacy — second priority after performance",
    "",
    "The minimum bar:",
    "",
    "1. item one",
    "2. item two",
    "3. item three",
    "4. item four",
    "5. item five",
    "6. item six",
    item7,
    item8,
    "",
    "## Pattern conformance index",
    "",
  ].join("\n");
}

describe("checkVisionRule13NonTaskAnchors — pure-function paired fixtures", () => {
  test("passes when items 7 and 8 carry every required anchor", () => {
    const r = checkVisionRule13NonTaskAnchors(fixtureSection());
    expect(r.ok).toBe(true);
  });

  test("fails when item 7 drops GDPR Article 25", () => {
    const r = checkVisionRule13NonTaskAnchors(
      fixtureSection({
        item7: "7. Privacy by default — no anchor at all but mentions OWASP Privacy Top 10.",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("item #7");
    expect(r.errors[0]).toContain("GDPR Article 25");
  });

  test("fails when item 7 drops OWASP Privacy Top 10", () => {
    const r = checkVisionRule13NonTaskAnchors(
      fixtureSection({
        item7: "7. Privacy by default — Industry standard: GDPR Article 25 only.",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("OWASP Privacy Top 10");
  });

  test("fails when item 8 drops STRIDE", () => {
    const r = checkVisionRule13NonTaskAnchors(
      fixtureSection({ item8: "8. Threat model — methodology unspecified." }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("item #8");
    expect(r.errors[0]).toContain("STRIDE");
  });

  test("aggregates failures across both items when both drift", () => {
    const r = checkVisionRule13NonTaskAnchors(
      fixtureSection({
        item7: "7. nothing here",
        item8: "8. nothing here either",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 2 anchors missing for item 7 + 1 for item 8.
    expect(r.errors.length).toBe(3);
  });

  test("fails when the rule-#13 section heading is absent", () => {
    const r = checkVisionRule13NonTaskAnchors("# nothing\n## here\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("`### 13. Security & privacy`");
  });

  test("fails when item 7 is missing entirely (only items 1-6 + 8 present)", () => {
    const text = [
      "### 13. Security & privacy",
      "",
      "1. one",
      "2. two",
      "3. three",
      "4. four",
      "5. five",
      "6. six",
      "8. **Threat model** — Industry standard: STRIDE.",
      "",
      "## next",
    ].join("\n");
    const r = checkVisionRule13NonTaskAnchors(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("item #7 not found"))).toBe(true);
  });

  test("rejects a substring near-miss (must match the proper-noun word boundary)", () => {
    // "STRIDEx" should not satisfy the STRIDE token (word-boundary in the regex).
    const r = checkVisionRule13NonTaskAnchors(
      fixtureSection({
        item8: "8. Threat model — Industry standard: STRIDExx (typo).",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("STRIDE");
  });

  test("REQUIRED_ANCHORS is the canonical map (matches the items the spec requires)", () => {
    expect([...REQUIRED_ANCHORS.keys()]).toEqual([7, 8]);
    expect(REQUIRED_ANCHORS.get(7)?.map((a) => a.name)).toEqual([
      "GDPR Article 25",
      "OWASP Privacy Top 10",
    ]);
    expect(REQUIRED_ANCHORS.get(8)?.map((a) => a.name)).toEqual(["STRIDE"]);
  });
});

describe("real vision.md — items 7 & 8 anchor invariant on main", () => {
  test("vision.md § 13 items 7 and 8 each carry their named industry-standard anchor", async () => {
    const text = await readFile(resolve(REPO_ROOT, "vision.md"), "utf8");
    const r = checkVisionRule13NonTaskAnchors(text);
    if (!r.ok) {
      throw new Error(
        `vision.md violates rule-13 non-task anchor pin:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(r.ok).toBe(true);
  });
});
