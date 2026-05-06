// Paired tests for `check-rule-13-sibling-anchors.mjs`. Pattern: deterministic
// gate over TASKS.md substrate cohesion (vision.md rule #13 ↔ the 6 sibling
// P0s' Anchor citations). Tests follow the standard positive / negative
// fixture shape (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  SIBLING_P0_IDS,
  checkRule13SiblingAnchors,
  extractAnchorsForIds,
} from "./check-rule-13-sibling-anchors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @param {string} id
 * @param {string} anchor
 * @returns {string}
 */
function fixtureBlock(id, anchor) {
  return [
    `- [ ] \`${id}\` — title`,
    `  - **ID**: ${id}`,
    "  - **Tags**: tag1, tag2",
    `  - **Anchor**: ${anchor}`,
    "",
  ].join("\n");
}

describe("checkRule13SiblingAnchors — pure-function paired fixtures", () => {
  test("passes when every sibling P0 anchor cites `rule #13`", () => {
    const text = SIBLING_P0_IDS.map((id) =>
      fixtureBlock(id, "rule #13 (security); other-source 2024."),
    ).join("\n");
    const r = checkRule13SiblingAnchors(text);
    expect(r.ok).toBe(true);
  });

  test("fails naming the offender when one sibling P0 omits `rule #13`", () => {
    const text = SIBLING_P0_IDS.map((id, i) =>
      fixtureBlock(id, i === 2 ? "Saltzer & Schroeder 1975 — least privilege." : "rule #13."),
    ).join("\n");
    const r = checkRule13SiblingAnchors(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain(SIBLING_P0_IDS[2]);
    expect(r.errors[0]).toContain("rule #13");
  });

  test("fails for every offender when multiple siblings omit `rule #13`", () => {
    const text = SIBLING_P0_IDS.map((id) =>
      fixtureBlock(id, "OWASP Top 10; rule #1; rule #10."),
    ).join("\n");
    const r = checkRule13SiblingAnchors(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length);
  });

  test("fails when a sibling P0 task block is missing entirely", () => {
    const text = SIBLING_P0_IDS.slice(0, 3)
      .map((id) => fixtureBlock(id, "rule #13."))
      .join("\n");
    const r = checkRule13SiblingAnchors(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The 3 absent IDs each surface as "no Anchor line found".
    expect(r.errors.length).toBe(3);
    for (const e of r.errors) expect(e).toContain("no `**Anchor**:` line found");
  });

  test("matcher accepts `rule #13` and `Rule #13` and `rule#13` (whitespace + case-insensitive)", () => {
    for (const variant of ["rule #13", "Rule #13", "RULE  #13", "rule#13", "rule # 13"]) {
      const text = SIBLING_P0_IDS.map((id) => fixtureBlock(id, `${variant} (test).`)).join("\n");
      const r = checkRule13SiblingAnchors(text);
      expect(r.ok, `variant: "${variant}"`).toBe(true);
    }
  });

  test("matcher rejects `rule #1` and `rule #130` (substring trap)", () => {
    const text = SIBLING_P0_IDS.map((id) =>
      fixtureBlock(id, "rule #1 (don't reinvent); rule #130 (hypothetical)."),
    ).join("\n");
    const r = checkRule13SiblingAnchors(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(SIBLING_P0_IDS.length);
  });
});

describe("extractAnchorsForIds — TASKS.md parser", () => {
  test("captures the first Anchor line per ID and stops at the next task", () => {
    const text = [
      "- [ ] `task-A` — title",
      "  - **ID**: task-A",
      "  - **Anchor**: anchor-A-first",
      "  - **Anchor**: anchor-A-second-should-not-win",
      "- [ ] `task-B` — title",
      "  - **ID**: task-B",
      "  - **Anchor**: anchor-B",
      "",
    ].join("\n");
    const out = extractAnchorsForIds(text, ["task-A", "task-B"]);
    expect(out).toEqual([
      { id: "task-A", anchor: "anchor-A-first" },
      { id: "task-B", anchor: "anchor-B" },
    ]);
  });

  test("returns null anchor for IDs not present in the text", () => {
    const out = extractAnchorsForIds("# empty\n", ["nonexistent"]);
    expect(out).toEqual([{ id: "nonexistent", anchor: null }]);
  });
});

describe("real TASKS.md — the substrate-cohesion invariant on main", () => {
  test("the 6 sibling security P0s all cite rule #13 in their Anchor line", async () => {
    const text = await readFile(resolve(REPO_ROOT, "TASKS.md"), "utf8");
    const r = checkRule13SiblingAnchors(text);
    if (!r.ok) {
      throw new Error(
        `rule-13-sibling-anchors violation:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
    expect(r.ok).toBe(true);
  });
});
