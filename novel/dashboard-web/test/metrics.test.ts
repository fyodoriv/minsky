import { describe, expect, it } from "vitest";

import { SUCCESS_METRICS } from "../src/metrics.js";

describe("SUCCESS_METRICS — 10 vision.md success criteria", () => {
  it("contains exactly 10 entries (one per vision.md § 'Success criteria' row)", () => {
    expect(SUCCESS_METRICS).toHaveLength(10);
  });

  it("every id is kebab-case (lowercase, digits, single hyphens, no leading/trailing dash)", () => {
    const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    for (const m of SUCCESS_METRICS) {
      expect(m.id).toMatch(KEBAB);
    }
  });

  it("has no duplicate ids (Set comparison)", () => {
    const ids = SUCCESS_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
