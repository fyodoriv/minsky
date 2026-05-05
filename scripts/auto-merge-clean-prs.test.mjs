import { describe, expect, it } from "vitest";

import { pickMergeable } from "./auto-merge-clean-prs.mjs";

/**
 * @param {Partial<import("./auto-merge-clean-prs.mjs").PrSummary>} overrides
 * @returns {import("./auto-merge-clean-prs.mjs").PrSummary}
 */
function pr(overrides) {
  return {
    number: 1,
    title: "test",
    mergeStateStatus: "CLEAN",
    isDraft: false,
    labels: [],
    ...overrides,
  };
}

describe("pickMergeable", () => {
  it("returns CLEAN non-draft PRs without minsky-no-merge label", () => {
    expect(pickMergeable([pr({ number: 1 })])).toHaveLength(1);
  });

  it("filters out drafts", () => {
    expect(pickMergeable([pr({ number: 1, isDraft: true })])).toHaveLength(0);
  });

  it("filters out non-CLEAN states", () => {
    const states = ["BEHIND", "BLOCKED", "DIRTY", "UNSTABLE", "UNKNOWN", "HAS_HOOKS"];
    for (const state of states) {
      expect(pickMergeable([pr({ mergeStateStatus: state })])).toHaveLength(0);
    }
  });

  it("filters out PRs labeled minsky-no-merge (operator escape hatch)", () => {
    expect(pickMergeable([pr({ number: 1, labels: [{ name: "minsky-no-merge" }] })])).toHaveLength(
      0,
    );
  });

  it("preserves PRs with unrelated labels", () => {
    expect(pickMergeable([pr({ number: 1, labels: [{ name: "enhancement" }] })])).toHaveLength(1);
  });

  it("returns empty array when given empty snapshot", () => {
    expect(pickMergeable([])).toEqual([]);
  });

  it("handles a mixed batch — keeps CLEAN, drops the rest", () => {
    const result = pickMergeable([
      pr({ number: 1, mergeStateStatus: "CLEAN" }),
      pr({ number: 2, mergeStateStatus: "DIRTY" }),
      pr({ number: 3, isDraft: true }),
      pr({ number: 4, labels: [{ name: "minsky-no-merge" }] }),
      pr({ number: 5, mergeStateStatus: "CLEAN" }),
    ]);
    expect(result.map((p) => p.number)).toEqual([1, 5]);
  });
});
