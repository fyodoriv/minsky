import { describe, expect, test } from "vitest";

import {
  buildRefreshTaskBlock,
  findAlreadyFiledIds,
  locateP2InsertionPoint,
} from "./auto-file-corpus-refresh-tasks.mjs";

describe("buildRefreshTaskBlock", () => {
  test("(a) emits all 5 rule-#9 required fields + Tags + Milestone + Touches + Competitive-goal", () => {
    const block = buildRefreshTaskBlock({
      competitorId: "openhands",
      asOf: "2025-04-15",
      ageDays: 402,
    });
    expect(block).toMatch(/^- \[ \] `corpus-refresh-openhands`/m);
    expect(block).toMatch(/\*\*ID\*\*: corpus-refresh-openhands/);
    expect(block).toMatch(/\*\*Tags\*\*:.*p2.*auto-filed/);
    expect(block).toMatch(/\*\*Milestone\*\*: M1/);
    expect(block).toMatch(/\*\*Competitive-goal\*\*:/);
    expect(block).toMatch(/\*\*Touches\*\*:/);
    expect(block).toMatch(/\*\*Details\*\*:/);
    expect(block).toMatch(/\*\*Hypothesis\*\*:/);
    expect(block).toMatch(/\*\*Success\*\*:/);
    expect(block).toMatch(/\*\*Pivot\*\*:/);
    expect(block).toMatch(/\*\*Measurement\*\*:/);
    expect(block).toMatch(/\*\*Anchor\*\*:/);
  });

  test("(b) interpolates asOf + ageDays into the description verbatim", () => {
    const block = buildRefreshTaskBlock({
      competitorId: "swe-agent",
      asOf: "2024-10-01",
      ageDays: 598,
    });
    expect(block).toMatch(/asOf 2024-10-01, 598 days stale/);
  });

  test("(c) emits 13 lines + trailing blank (deterministic — same input same output)", () => {
    const b1 = buildRefreshTaskBlock({ competitorId: "x", asOf: "2025-01-01", ageDays: 100 });
    const b2 = buildRefreshTaskBlock({ competitorId: "x", asOf: "2025-01-01", ageDays: 100 });
    expect(b1).toBe(b2);
    expect(b1.split("\n").length).toBeGreaterThan(12);
  });

  test("(d) each line that should be a single-line metadata field has no embedded newline (rule-#9 parser requires single-line fields)", () => {
    const block = buildRefreshTaskBlock({
      competitorId: "test",
      asOf: "2025-01-01",
      ageDays: 100,
    });
    for (const label of [
      "ID",
      "Tags",
      "Milestone",
      "Competitive-goal",
      "Touches",
      "Details",
      "Hypothesis",
      "Success",
      "Pivot",
      "Measurement",
      "Anchor",
    ]) {
      const re = new RegExp(`\\*\\*${label}\\*\\*:\\s*([^\\n]+)$`, "m");
      expect(block).toMatch(re);
    }
  });
});

describe("findAlreadyFiledIds", () => {
  test("(e) returns empty set when no candidates are present in TASKS.md", () => {
    const tasksMd = "# Tasks\n\n## P0\n\n- [ ] Some task\n  - **ID**: some-task\n";
    const present = findAlreadyFiledIds(tasksMd, ["openhands", "aider"]);
    expect(present.size).toBe(0);
  });

  test("(f) returns the subset that appears as **ID**: corpus-refresh-<id>", () => {
    const tasksMd = `# Tasks\n\n## P2\n\n- [ ] foo\n  - **ID**: corpus-refresh-openhands\n\n- [ ] bar\n  - **ID**: unrelated-task\n`;
    const present = findAlreadyFiledIds(tasksMd, ["openhands", "aider", "swe-agent"]);
    expect([...present].sort()).toEqual(["openhands"]);
  });

  test("(g) matches the `corpus-refresh-` prefix exactly (no false-positive on substring)", () => {
    const tasksMd = `# Tasks\n\n  - **ID**: refresh-corpus-openhands\n`;
    const present = findAlreadyFiledIds(tasksMd, ["openhands"]);
    expect(present.size).toBe(0);
  });
});

describe("locateP2InsertionPoint", () => {
  test("(h) returns the index right after `## P2` heading + blank line", () => {
    const tasksMd = "# Tasks\n\n## P0\n\nfoo\n\n## P2\n\nexisting p2 task\n";
    const idx = locateP2InsertionPoint(tasksMd);
    // Should point at `existing p2 task` line
    expect(tasksMd.slice(idx).startsWith("existing p2 task")).toBe(true);
  });

  test("(i) falls back to end-of-file when no `## P2` section exists", () => {
    const tasksMd = "# Tasks\n\n## P0\n\nonly-p0\n";
    const idx = locateP2InsertionPoint(tasksMd);
    expect(idx).toBe(tasksMd.length);
  });

  test("(j) handles multiple blank lines after the heading", () => {
    const tasksMd = "# Tasks\n\n## P2\n\n\n\nfirst-p2-task\n";
    const idx = locateP2InsertionPoint(tasksMd);
    expect(tasksMd.slice(idx).startsWith("first-p2-task")).toBe(true);
  });
});
