import { describe, expect, it } from "vitest";

import { DEFAULT_LOOKBACK_ITERATIONS, oscillation } from "./oscillation.js";
import type { RolloutHistoryEntry } from "./sustained-gain.js";

const entry = (overrides: Partial<RolloutHistoryEntry> = {}): RolloutHistoryEntry => ({
  iteration: 1,
  ts: "2026-05-01T00:00:00Z",
  variantId: "rule-9-direct-answer",
  decision: "rejected",
  ...overrides,
});

describe("oscillation", () => {
  it("returns true on first proposal of a never-seen variant", () => {
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history: [],
    });
    expect(result.ok).toBe(true);
  });

  it("returns false when the variant was rejected within the lookback window", () => {
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 8, variantId: "rule-9-direct-answer", decision: "rejected" }),
    ];
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history,
      lookbackIterations: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/oscillation/);
  });

  it("returns true when the rejection is older than the lookback window", () => {
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 1, variantId: "rule-9-direct-answer", decision: "rejected" }),
      ...Array.from({ length: 11 }, (_, i) =>
        entry({
          iteration: i + 2,
          variantId: "rule-9-tighten-scope",
          decision: "rollout",
        }),
      ),
    ];
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history,
      lookbackIterations: 10,
    });
    expect(result.ok).toBe(true);
  });

  it("treats `abstain` as a rejection signal (the loop did not adopt the variant)", () => {
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 5, variantId: "rule-9-direct-answer", decision: "abstain" }),
    ];
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history,
      lookbackIterations: 10,
    });
    expect(result.ok).toBe(false);
  });

  it("does NOT block when the variant was previously rolled out (sustained-gain dynamic)", () => {
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 5, variantId: "rule-9-direct-answer", decision: "rollout" }),
    ];
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history,
      lookbackIterations: 10,
    });
    expect(result.ok).toBe(true);
  });

  it("uses DEFAULT_LOOKBACK_ITERATIONS when none is supplied", () => {
    const history: RolloutHistoryEntry[] = [
      entry({ iteration: 100, variantId: "rule-9-direct-answer", decision: "rejected" }),
    ];
    // Default = 10. The entry at iteration 100 is in the most-recent slice.
    const result = oscillation({
      proposedVariantId: "rule-9-direct-answer",
      history,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(new RegExp(`${DEFAULT_LOOKBACK_ITERATIONS}`));
  });
});
