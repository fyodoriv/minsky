// Tests for check-competitive-goal.mjs. Slice (d) of
// `self-metrics-competitive-benchmark`. Pattern: deterministic rule-#10
// ratchet over the `**Competitive-goal**:` TASKS.md field. Paired
// positive/negative fixtures (Meszaros 2007, *xUnit Test Patterns*) plus
// dormant-when-marker-absent (rule #7 graceful degrade) and
// dormant-on-missing-file.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  ENFORCE_MARKER,
  checkCompetitiveGoal,
  parseTaskBlocks,
  readTasksMd,
} from "./check-competitive-goal.mjs";

const MARKER_LINE = `<!-- policy: ${ENFORCE_MARKER} -->`;

const BLOCK_WITH_GOAL = `- [ ] \`alpha\` — do the alpha thing
  - **ID**: alpha
  - **Hypothesis**: alpha moves the needle.
  - **Competitive-goal**: autonomous-merge-rate +5pp vs OpenHands.
`;

const BLOCK_MISSING_GOAL = `- [ ] \`beta\` — do the beta thing
  - **ID**: beta
  - **Hypothesis**: beta also moves the needle.
`;

const TRIVIAL_BLOCK_NO_HYPOTHESIS = `- [ ] \`gamma\` — fix a typo in a comment
  - **ID**: gamma
  - **Details**: trivial, rule-#9-exempt.
`;

describe("checkCompetitiveGoal (pure)", () => {
  test("marker absent → dormant: enforced=false, ok=true even with a violating block", () => {
    const result = checkCompetitiveGoal({ tasksMd: BLOCK_MISSING_GOAL });
    expect(result.enforced).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("marker present, all Hypothesis blocks have Competitive-goal → ok", () => {
    const tasksMd = `${MARKER_LINE}\n${BLOCK_WITH_GOAL}`;
    const result = checkCompetitiveGoal({ tasksMd });
    expect(result.enforced).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("marker present, a Hypothesis block omits Competitive-goal → violation naming the id", () => {
    const tasksMd = `${MARKER_LINE}\n${BLOCK_WITH_GOAL}\n${BLOCK_MISSING_GOAL}`;
    const result = checkCompetitiveGoal({ tasksMd });
    expect(result.enforced).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    const [v] = result.violations;
    if (!v) throw new Error("unreachable: expected one violation");
    expect(v.id).toBe("beta");
    expect(v.reason).toMatch(/\*\*Competitive-goal\*\*/);
    expect(v.reason).toMatch(/rule-#9/);
  });

  test("trivial block without Hypothesis is rule-#9-exempt → no violation even when enforced", () => {
    const tasksMd = `${MARKER_LINE}\n${TRIVIAL_BLOCK_NO_HYPOTHESIS}`;
    const result = checkCompetitiveGoal({ tasksMd });
    expect(result.enforced).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("multiple violations are all reported", () => {
    const second = BLOCK_MISSING_GOAL.replace(/beta/g, "delta");
    const tasksMd = `${MARKER_LINE}\n${BLOCK_MISSING_GOAL}\n${second}`;
    const result = checkCompetitiveGoal({ tasksMd });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.id).sort()).toEqual(["beta", "delta"]);
  });

  test("ENFORCE_MARKER is the exact pinned activation substring", () => {
    expect(ENFORCE_MARKER).toBe("competitive-goal-enforced");
  });
});

describe("parseTaskBlocks (block boundaries)", () => {
  test("headings end a block; pre-task content is ignored; sub-tasks stay in the block", () => {
    const tasksMd = [
      "# Tasks",
      "<!-- policy: something -->",
      "## P0",
      "- [ ] `one` — first",
      "  - **ID**: one",
      "  - [ ] a sub-task that must not start a new block",
      "  - **Hypothesis**: h1",
      "## P1",
      "- [x] `two` — second (done)",
      "  - **ID**: two",
    ].join("\n");
    const blocks = parseTaskBlocks(tasksMd);
    expect(blocks.map((b) => b.id)).toEqual(["one", "two"]);
    const [first] = blocks;
    if (!first) throw new Error("unreachable: expected two blocks");
    expect(first.raw).toContain("a sub-task");
    expect(first.raw).not.toContain("## P1");
  });

  test("falls back to the task title when no **ID** field is present", () => {
    const blocks = parseTaskBlocks("- [ ] `slug-only` — desc\n  - **Details**: x");
    expect(blocks).toHaveLength(1);
    const [only] = blocks;
    if (!only) throw new Error("unreachable: expected one block");
    expect(only.id).toContain("slug-only");
  });
});

describe("readTasksMd (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(tmpdir(), `competitive-goal-test-${process.pid}-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("missing file (ENOENT) → null (dormant state)", () => {
    expect(readTasksMd(join(dir, "nope.md"))).toBeNull();
  });

  test("present file → its contents", () => {
    const path = join(dir, "TASKS.md");
    writeFileSync(path, BLOCK_WITH_GOAL);
    expect(readTasksMd(path)).toBe(BLOCK_WITH_GOAL);
  });
});
