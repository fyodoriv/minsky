// Paired tests for scripts/sweep-stale-task-blocks.mjs.
//
// Pinned cases (rule #9 — pre-registration):
//   (a) fixture with one DELIVERED-retained block → parseStalePatchCandidates returns length 1
//   (b) fixture with zero retained blocks         → parseStalePatchCandidates returns length 0
//   (c) block with DELIVERED but no freeform-cite → skipped (not included in results)
//   (d) findCitingFiles returns [] when rg has no matches
//
// Source: scripts/sweep-stale-task-blocks.mjs (the script under test).

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { findCitingFiles, parseStalePatchCandidates } from "./sweep-stale-task-blocks.mjs";

const STALE_BLOCK = [
  "- [ ] `my-task-id` — some task",
  "  - **ID**: my-task-id",
  "  - **Blocked**: needs-operator — DELIVERED (merged); block retained — test files freeform-cite this id",
  "  - **Tags**: p0",
].join("\n");

const NORMAL_BLOCK = [
  "- [ ] `other-task` — normal task",
  "  - **ID**: other-task",
  "  - **Tags**: p1",
].join("\n");

const AMBIGUOUS_BLOCK = [
  "- [ ] `ambig-task` — some task",
  "  - **ID**: ambig-task",
  "  - **Blocked**: needs-operator — DELIVERED; block retained for other reason",
  "  - **Tags**: p1",
].join("\n");

describe("parseStalePatchCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("(a) identifies DELIVERED-retained block with freeform-cite", () => {
    const content = [STALE_BLOCK, NORMAL_BLOCK].join("\n\n");
    const results = parseStalePatchCandidates(content);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("my-task-id");
  });

  test("(b) returns empty array when no stale blocks exist", () => {
    const content = [NORMAL_BLOCK].join("\n\n");
    const results = parseStalePatchCandidates(content);
    expect(results).toHaveLength(0);
  });

  test("(c) skips DELIVERED block without freeform-cite substring", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const content = [AMBIGUOUS_BLOCK, NORMAL_BLOCK].join("\n\n");
    const results = parseStalePatchCandidates(content);
    expect(results).toHaveLength(0);
    const stderrCalls = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderrCalls).toContain("skipping");
    expect(stderrCalls).toContain("ambig-task");
    expect(stderrCalls).toContain("operator review");
  });
});

describe("findCitingFiles", () => {
  test("(d) returns empty array when no search dirs exist in repoRoot", () => {
    const emptyRoot = mkdtempSync(`${tmpdir()}/sweep-test-`);
    const files = findCitingFiles("any-task-id", emptyRoot);
    expect(files).toEqual([]);
  });
});
