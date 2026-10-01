// @ts-check
// Colocated test for cto-audit-rule-9-reject-rate.mjs (test-file-colocation).
import { describe, expect, it } from "vitest";

import { computeRejectRate } from "./cto-audit-rule-9-reject-rate.mjs";

describe("computeRejectRate", () => {
  it("returns a zero rate for an empty log", () => {
    expect(computeRejectRate("")).toEqual({
      rule_9_reject_rate: 0,
      rule_9_skip_count: 0,
      rule_9_retry_success_count: 0,
    });
  });

  it("computes skip / (skip + retry-success)", () => {
    const log = [
      JSON.stringify({ event: "audit-skip" }),
      JSON.stringify({ event: "audit-retry-success" }),
      JSON.stringify({ event: "audit-retry-success" }),
    ].join("\n");
    const result = computeRejectRate(log);
    expect(result.rule_9_skip_count).toBe(1);
    expect(result.rule_9_retry_success_count).toBe(2);
    expect(result.rule_9_reject_rate).toBeCloseTo(1 / 3);
  });

  it("ignores malformed lines and unknown event types", () => {
    const log = [
      "not json",
      "{}",
      JSON.stringify({ event: "other" }),
      JSON.stringify({ event: "audit-skip" }),
    ].join("\n");
    const result = computeRejectRate(log);
    expect(result.rule_9_skip_count).toBe(1);
    expect(result.rule_9_retry_success_count).toBe(0);
    expect(result.rule_9_reject_rate).toBe(1);
  });
});
