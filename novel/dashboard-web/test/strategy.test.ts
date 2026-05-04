import { describe, expect, it } from "vitest";

import type { SuccessMetric } from "../src/metrics.js";
import { constantGetValue, snapshotGetValue } from "../src/strategy.js";

const sample: SuccessMetric = {
  id: "loop-uptime",
  label: "Loop uptime",
  formula: "x",
  unit: "fraction",
};

describe("snapshotGetValue — JSON-snapshot-backed Strategy", () => {
  it("returns the snapshot value when the metric id is present", () => {
    const lookup = snapshotGetValue({ "loop-uptime": "0.99" });
    expect(lookup(sample)).toBe("0.99");
  });

  it("returns null for unknown metric ids (falls back to `(stub)` upstream)", () => {
    const lookup = snapshotGetValue({ other: "1" });
    expect(lookup(sample)).toBeNull();
  });

  it("returns null on an empty snapshot (cold-start contract)", () => {
    expect(snapshotGetValue({})(sample)).toBeNull();
  });
});

describe("constantGetValue — smoke-test Strategy", () => {
  it("returns the same string for every metric", () => {
    const lookup = constantGetValue("42");
    expect(lookup(sample)).toBe("42");
    expect(lookup({ ...sample, id: "other" })).toBe("42");
  });
});
