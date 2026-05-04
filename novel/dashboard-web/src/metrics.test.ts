import { describe, expect, it } from "vitest";

import { PLACEHOLDER_METRICS } from "./metrics.js";

describe("PLACEHOLDER_METRICS — v0 skeleton stub", () => {
  it("contains exactly one entry (sub-task 2 expands to 10)", () => {
    expect(PLACEHOLDER_METRICS).toHaveLength(1);
  });

  it("its id is the literal `placeholder` (the contract the test harness asserts)", () => {
    expect(PLACEHOLDER_METRICS[0]?.id).toBe("placeholder");
  });

  it("every id is kebab-case (anticipates the sub-task 2 invariant)", () => {
    const KEBAB = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
    for (const m of PLACEHOLDER_METRICS) {
      expect(m.id).toMatch(KEBAB);
    }
  });
});
