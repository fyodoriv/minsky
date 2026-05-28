// Tests for the pure functions in check-rule-9-tasksmd-fields.mjs.
// Pattern: rule #10 deterministic gate; xUnit paired fixtures
// (Meszaros, *xUnit Test Patterns*, 2007).

import { describe, expect, test } from "vitest";

import {
  RULE_9_GRANDFATHERED,
  classifyRule9Blocks,
  parseRule9Blocks,
} from "./check-rule-9-tasksmd-fields.mjs";

const COMPLIANT = [
  "- [ ] `task-a` — first task",
  "  - **ID**: task-a",
  "  - **Tags**: p0",
  "  - **Hypothesis**: x reduces y",
  "  - **Success**: y < 5",
  "  - **Pivot**: y > 10",
  "  - **Measurement**: `pnpm test`",
  "  - **Anchor**: rule #9",
  "",
].join("\n");

const COMPLIANT_ACCEPTANCE = [
  "- [ ] `task-b` — second task uses Acceptance",
  "  - **ID**: task-b",
  "  - **Tags**: p1",
  "  - **Hypothesis**: x reduces y",
  "  - **Acceptance**: (1) y is < 5; (2) tests pass",
  "  - **Pivot**: y > 10",
  "  - **Measurement**: `pnpm test`",
  "  - **Anchor**: rule #9",
  "",
].join("\n");

const MISSING_SUCCESS = [
  "- [ ] `task-c` — missing Success/Acceptance",
  "  - **ID**: task-c",
  "  - **Tags**: p1",
  "  - **Hypothesis**: x reduces y",
  "  - **Pivot**: y > 10",
  "  - **Measurement**: `pnpm test`",
  "  - **Anchor**: rule #9",
  "",
].join("\n");

const MISSING_FOUR = [
  "- [ ] `task-d` — pre-rule-9 task (4 fields missing)",
  "  - **ID**: task-d",
  "  - **Tags**: p3",
  "  - **Details**: legacy block",
  "",
].join("\n");

describe("parseRule9Blocks", () => {
  test("compliant block ⇒ no missing fields", () => {
    const blocks = parseRule9Blocks(COMPLIANT);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("task-a");
    expect(blocks[0]?.missingFields).toEqual([]);
  });

  test("Acceptance is equivalent to Success", () => {
    const blocks = parseRule9Blocks(COMPLIANT_ACCEPTANCE);
    expect(blocks[0]?.missingFields).toEqual([]);
  });

  test("missing Success and no Acceptance ⇒ Success/Acceptance violation", () => {
    const blocks = parseRule9Blocks(MISSING_SUCCESS);
    expect(blocks[0]?.missingFields).toEqual(["Success/Acceptance"]);
  });

  test("legacy block missing 4 fields ⇒ all 4 reported", () => {
    const blocks = parseRule9Blocks(MISSING_FOUR);
    expect([...(blocks[0]?.missingFields ?? [])].sort()).toEqual(
      ["Anchor", "Hypothesis", "Measurement", "Pivot", "Success/Acceptance"].sort(),
    );
  });

  test("multiple blocks parsed correctly", () => {
    const blocks = parseRule9Blocks(`${COMPLIANT}\n${MISSING_SUCCESS}`);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.id).toBe("task-a");
    expect(blocks[1]?.id).toBe("task-c");
  });

  test("block boundary uses `**ID**:` line — body of one block does not bleed into the next", () => {
    const blocks = parseRule9Blocks(`${COMPLIANT}\n${MISSING_SUCCESS}`);
    // The first block does NOT contain the second block's `**ID**: task-c`
    expect(blocks[0]?.body).not.toContain("**ID**: task-c");
  });
});

describe("classifyRule9Blocks", () => {
  test("compliant blocks count toward `clean`", () => {
    const blocks = parseRule9Blocks(`${COMPLIANT}\n${COMPLIANT_ACCEPTANCE}`);
    const r = classifyRule9Blocks(blocks, new Set());
    expect(r.clean).toBe(2);
    expect(r.blocking).toEqual([]);
    expect(r.grandfathered).toEqual([]);
  });

  test("non-grandfathered violations end up in `blocking`", () => {
    const blocks = parseRule9Blocks(MISSING_SUCCESS);
    const r = classifyRule9Blocks(blocks, new Set());
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0]?.id).toBe("task-c");
  });

  test("grandfathered violations move to `grandfathered`, not `blocking`", () => {
    const blocks = parseRule9Blocks(MISSING_SUCCESS);
    const r = classifyRule9Blocks(blocks, new Set(["task-c"]));
    expect(r.blocking).toEqual([]);
    expect(r.grandfathered).toHaveLength(1);
  });

  test("mix of clean + grandfathered + blocking is reported correctly", () => {
    const blocks = parseRule9Blocks(`${COMPLIANT}\n${MISSING_SUCCESS}\n${MISSING_FOUR}`);
    // task-a clean, task-c grandfathered, task-d blocking
    const r = classifyRule9Blocks(blocks, new Set(["task-c"]));
    expect(r.clean).toBe(1);
    expect(r.grandfathered).toHaveLength(1);
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0]?.id).toBe("task-d");
  });
});

describe("RULE_9_GRANDFATHERED allowlist", () => {
  test("contains the surviving known violators from the 2026-05-19 audit", () => {
    // Original audit was 32 entries. 2026-05-28 dropped one entry
    // (the parent task block at task-block-fixture-cleanup) — the
    // corresponding allowlist entry was retired as part of the parent
    // task block's removal. Surviving count: 31.
    expect(RULE_9_GRANDFATHERED.size).toBe(31);
    expect(RULE_9_GRANDFATHERED.has("self-metrics-competitive-benchmark")).toBe(true);
  });

  test("does NOT include arbitrary task IDs (no accidental allowlist drift)", () => {
    expect(RULE_9_GRANDFATHERED.has("non-existent-task")).toBe(false);
  });
});

describe("live TASKS.md scan", () => {
  test("the live TASKS.md has zero non-grandfathered rule-9 violations", () => {
    // This is the gate the CI workflow + pre-pr-lint runs. If this
    // breaks, the new task is missing rule-#9 fields — fix the task,
    // do not add to RULE_9_GRANDFATHERED unless it pre-dates the lint.
    // We import the live file at test time to keep the lint and the
    // live state in lockstep.
    // Skipped when the working dir doesn't contain TASKS.md (CI keeps
    // the file at a known path; ad-hoc test runs may not).
    const fs = require("node:fs");
    const path = require("node:path");
    const tasksPath = path.resolve(__dirname, "..", "TASKS.md");
    if (!fs.existsSync(tasksPath)) return; // graceful skip
    const tasksMd = fs.readFileSync(tasksPath, "utf8");
    const blocks = parseRule9Blocks(tasksMd);
    const { blocking } = classifyRule9Blocks(blocks, RULE_9_GRANDFATHERED);
    expect(blocking.map((b) => b.id)).toEqual([]);
  });
});
