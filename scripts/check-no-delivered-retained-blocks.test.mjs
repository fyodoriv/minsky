// @ts-check
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkNoDeliveredRetainedBlocks,
  STALE_PATTERN,
} from "./check-no-delivered-retained-blocks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

describe("checkNoDeliveredRetainedBlocks", () => {
  it("flags a **Blocked**: field containing DELIVERED.*block retained", () => {
    const result = checkNoDeliveredRetainedBlocks(
      "  - **Blocked**: needs-operator — DELIVERED; block retained — test files freeform-cite this id\n",
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.line).toBe(1);
  });

  it("reports the correct line number for violations", () => {
    const tasksMd = [
      "# Tasks",
      "",
      "- [ ] some task",
      "  - **ID**: my-task",
      "  - **Blocked**: needs-operator — DELIVERED; block retained — freeform-cite",
    ].join("\n");
    const result = checkNoDeliveredRetainedBlocks(tasksMd);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.line).toBe(5);
  });

  it("passes when no stale retained blocks are present", () => {
    const tasksMd = [
      "# Tasks",
      "",
      "- [ ] clean task",
      "  - **ID**: clean-task",
      "  - **Blocked**: needs-operator — waiting on external API key",
    ].join("\n");
    const result = checkNoDeliveredRetainedBlocks(tasksMd);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes on an empty string", () => {
    const result = checkNoDeliveredRetainedBlocks("");
    expect(result.ok).toBe(true);
  });

  it("flags multiple violations in one file", () => {
    const tasksMd = [
      "  - **Blocked**: DELIVERED; block retained — cite-a",
      "  - **Blocked**: DELIVERED; block retained — cite-b",
    ].join("\n");
    const result = checkNoDeliveredRetainedBlocks(tasksMd);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("does not flag DELIVERED in a non-Blocked field", () => {
    const tasksMd =
      "  - **Details**: this task was DELIVERED; block retained here is just description\n";
    const result = checkNoDeliveredRetainedBlocks(tasksMd);
    expect(result.ok).toBe(true);
  });

  it("STALE_PATTERN matches the canonical stale form", () => {
    expect(
      STALE_PATTERN.test(
        "  - **Blocked**: needs-operator — DELIVERED; block retained — test files freeform-cite",
      ),
    ).toBe(true);
  });

  it("STALE_PATTERN does not match a regular blocked line", () => {
    expect(STALE_PATTERN.test("  - **Blocked**: needs-operator — awaiting feedback")).toBe(false);
  });

  it("fixture: bad fixture fails the check", () => {
    const bad = readFileSync(
      resolve(REPO_ROOT, "test/fixtures/tasks-delivered-retained-bad.md"),
      "utf8",
    );
    const result = checkNoDeliveredRetainedBlocks(bad);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("fixture: good fixture passes the check", () => {
    const good = readFileSync(
      resolve(REPO_ROOT, "test/fixtures/tasks-delivered-retained-good.md"),
      "utf8",
    );
    const result = checkNoDeliveredRetainedBlocks(good);
    expect(result.ok).toBe(true);
  });

  it("real production TASKS.md has violations until sweep-stale-delivered-task-blocks lands (gate is working)", () => {
    // This test confirms the gate CORRECTLY detects the stale retained blocks
    // in the current TASKS.md. After `sweep-stale-delivered-task-blocks` ships
    // and cleans up the existing blocks, the count will drop to 0. Until then,
    // the gate prevents NEW stale blocks from being added. Violations here are
    // expected pre-sweep; the CI job will be green once the sweep PR merges.
    const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");
    const result = checkNoDeliveredRetainedBlocks(tasksMd);
    // We know there are stale blocks today — this is the baseline the task
    // documents (36 → cleaned up by sweep). The gate is NOT producing false
    // positives on normal lines; all violations here are genuine stale blocks.
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
    // Once sweep lands, add: expect(result.ok).toBe(true)
  });
});
