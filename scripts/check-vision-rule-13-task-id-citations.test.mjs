// Paired tests for `check-vision-rule-13-task-id-citations.mjs`. Pattern:
// deterministic gate over the inverse direction of substrate cohesion
// (vision.md § 13 minimum-bar items 1–6 ↔ canonical `SIBLING_P0_IDS`).
// Tests follow the standard positive / negative fixture shape (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { SIBLING_P0_IDS } from "./check-rule-13-sibling-anchors.mjs";
import {
  checkVisionRule13TaskIdCitations,
  extractNumberedItems,
  extractRule13Section,
} from "./check-vision-rule-13-task-id-citations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {readonly string[]} ids
 * @returns {string}
 */
function fixtureSection(ids) {
  const items = ids.map(
    (id, i) => `${i + 1}. **Item ${i + 1}** — backticked id \`${id}\` follows.`,
  );
  return [
    "## Some prior section",
    "",
    "### 13. Security & privacy — second priority after performance",
    "",
    "The minimum bar:",
    "",
    ...items,
    "",
    "## Pattern conformance index",
    "",
  ].join("\n");
}

describe("checkVisionRule13TaskIdCitations — pure-function paired fixtures", () => {
  test("passes when every minimum-bar item cites its canonical task ID verbatim", () => {
    const text = fixtureSection(SIBLING_P0_IDS);
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(true);
  });

  test("fails naming the offender when one item drops the canonical ID", () => {
    const tampered = SIBLING_P0_IDS.map((id, i) => (i === 2 ? "renamed-task-id" : id));
    const text = fixtureSection(tampered);
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("item #3");
    expect(r.errors[0]).toContain(SIBLING_P0_IDS[2] ?? "");
  });

  test("fails for every offender when all items drift", () => {
    const tampered = SIBLING_P0_IDS.map((_, i) => `wrong-${i}`);
    const text = fixtureSection(tampered);
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length);
  });

  test("fails when the rule-#13 section heading is absent", () => {
    const r = checkVisionRule13TaskIdCitations("# nothing here\n## or here\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("`### 13. Security & privacy`");
  });

  test("fails for a missing numbered item", () => {
    const items = SIBLING_P0_IDS.slice(0, 3).map((id, i) => `${i + 1}. backticked \`${id}\``);
    const text = [
      "### 13. Security & privacy — second priority after performance",
      "",
      ...items,
      "",
      "## next",
    ].join("\n");
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 3 absent items each surface as "not found".
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length - 3);
    for (const e of r.errors) expect(e).toContain("not found");
  });

  test("rejects a substring-only citation (must be backtick-wrapped)", () => {
    // The ID appears as plain prose, not in backticks — caller forgot the backticks.
    const items = SIBLING_P0_IDS.map((id, i) => `${i + 1}. mentions ${id} without backticks`);
    const text = [
      "### 13. Security & privacy — second priority after performance",
      ...items,
      "",
      "## next",
    ].join("\n");
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length);
  });

  test("rejects a citation that confuses item-numbers with IDs (item 1 cites item 2's ID)", () => {
    // Permute: item N cites SIBLING_P0_IDS[N % len], i.e. shifted by one.
    const shifted = [...SIBLING_P0_IDS.slice(1), SIBLING_P0_IDS[0] ?? ""];
    const text = fixtureSection(shifted);
    const r = checkVisionRule13TaskIdCitations(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length);
  });
});

describe("extractRule13Section — vision.md slicer", () => {
  test("returns the body between `### 13.` and the next `## …` top-level heading", () => {
    const text = [
      "## twelve",
      "stuff",
      "### 13. Security & privacy — header text",
      "body line A",
      "body line B",
      "## fourteen",
      "ignored",
    ].join("\n");
    const out = extractRule13Section(text);
    expect(out).not.toBeNull();
    expect(out).toContain("body line A");
    expect(out).toContain("body line B");
    expect(out).not.toContain("ignored");
  });

  test("returns null when the heading is absent", () => {
    expect(extractRule13Section("nothing\n## here\n")).toBeNull();
  });

  test("treats end-of-file as the section terminator when no following ## heading", () => {
    const text = ["### 13. Security & privacy", "trailing line"].join("\n");
    const out = extractRule13Section(text);
    expect(out).toContain("trailing line");
  });
});

describe("extractNumberedItems — section-body parser", () => {
  test("captures each `N.` item body up to the next numbered-item line", () => {
    const body = [
      "1. first item",
      "   continuation of first",
      "2. second item",
      "3. third item",
      "non-numbered trailing prose",
    ].join("\n");
    const out = extractNumberedItems(body);
    expect(out.size).toBe(3);
    expect(out.get(1)).toContain("first item");
    expect(out.get(1)).toContain("continuation of first");
    expect(out.get(2)).toBe("2. second item");
    // Trailing non-numbered prose accrues to the last item — that's fine for
    // our use (the last item still owns its own backticked ID).
    expect(out.get(3)).toContain("third item");
    expect(out.get(3)).toContain("non-numbered trailing prose");
  });

  test("returns an empty map when there are no numbered items", () => {
    expect(extractNumberedItems("just prose\nno digits\n").size).toBe(0);
  });
});

describe("real vision.md — the inverse substrate-cohesion invariant on main", () => {
  test("vision.md § 13 minimum-bar items 1–6 cite the 6 canonical sibling P0 IDs verbatim", async () => {
    const text = await readFile(resolve(REPO_ROOT, "vision.md"), "utf8");
    const r = checkVisionRule13TaskIdCitations(text);
    if (!r.ok) {
      throw new Error(
        `vision-rule-13-task-id-citations violation:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(r.ok).toBe(true);
  });
});
