import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_COST, SEVERITY_THRESHOLDS, analyze, costEstimate } from "./analyze.js";
import type { HealthSnapshot, RuleViolationStats } from "./monitor.js";

const stats = (overrides: Partial<RuleViolationStats> = {}): RuleViolationStats => ({
  ruleId: "rule-9",
  violationCount: 1,
  firstSeen: "2026-05-01T00:00:00Z",
  lastSeen: "2026-05-01T00:00:00Z",
  exemplars: [],
  ...overrides,
});

const snap = (violations: readonly RuleViolationStats[] = []): HealthSnapshot => ({
  violations,
  experiments: { validated: 0, regressed: 0, inconclusive: 0 },
  ciFailureCount: 0,
  advisoryCount: 0,
  warnings: [],
});

describe("analyze", () => {
  it("returns null constraint for an empty snapshot", () => {
    const a = analyze({ snapshot: snap() });
    expect(a.topConstraint).toBeNull();
    expect(a.evidence).toBeNull();
    expect(a.severity).toBeNull();
  });

  it("picks the rule with the highest violationCount × cost product", () => {
    const a = analyze({
      snapshot: snap([
        stats({ ruleId: "rule-1", violationCount: 10 }),
        stats({ ruleId: "rule-9", violationCount: 2 }),
      ]),
      costs: { "rule-1": 1, "rule-9": 100 }, // rule-9: 2*100 = 200 > rule-1: 10*1 = 10
    });
    expect(a.topConstraint?.ruleId).toBe("rule-9");
    expect(a.evidence?.violationCount).toBe(2);
    expect(a.evidence?.costEstimate).toBe(100);
    expect(a.severity).toBe("high");
  });

  it("breaks ties alphabetically by ruleId (first-seen would also work; alphabetical is the contract)", () => {
    const a = analyze({
      snapshot: snap([
        stats({ ruleId: "rule-z", violationCount: 5 }),
        stats({ ruleId: "rule-a", violationCount: 5 }),
        stats({ ruleId: "rule-m", violationCount: 5 }),
      ]),
    });
    expect(a.topConstraint?.ruleId).toBe("rule-a");
  });

  it("returns a constraint even for a single-violation snapshot", () => {
    const a = analyze({
      snapshot: snap([stats({ ruleId: "rule-7", violationCount: 1, exemplars: ["e1"] })]),
    });
    expect(a.topConstraint?.ruleId).toBe("rule-7");
    expect(a.evidence?.exemplarRecords).toEqual(["e1"]);
    expect(a.severity).toBe("low"); // 1 * 1 = 1 < medium threshold (3)
  });

  it("severity buckets: low / medium / high", () => {
    const low = analyze({
      snapshot: snap([stats({ violationCount: SEVERITY_THRESHOLDS.medium - 1 })]),
    });
    expect(low.severity).toBe("low");
    const medium = analyze({
      snapshot: snap([stats({ violationCount: SEVERITY_THRESHOLDS.medium })]),
    });
    expect(medium.severity).toBe("medium");
    const high = analyze({ snapshot: snap([stats({ violationCount: SEVERITY_THRESHOLDS.high })]) });
    expect(high.severity).toBe("high");
  });

  it("ignores zero-violationCount rules even if they appear in the snapshot", () => {
    const a = analyze({
      snapshot: snap([
        stats({ ruleId: "rule-1", violationCount: 0 }),
        stats({ ruleId: "rule-9", violationCount: 1 }),
      ]),
    });
    expect(a.topConstraint?.ruleId).toBe("rule-9");
  });

  it("forwards exemplars from the monitor into the constraint evidence", () => {
    const a = analyze({
      snapshot: snap([stats({ violationCount: 3, exemplars: ["e1", "e2", "e3"] })]),
    });
    expect(a.evidence?.exemplarRecords).toEqual(["e1", "e2", "e3"]);
  });
});

describe("costEstimate", () => {
  it("returns the schedule weight when present and positive", () => {
    expect(costEstimate("rule-9", { "rule-9": 5 })).toBe(5);
  });

  it("falls back to DEFAULT_RULE_COST for missing entries", () => {
    expect(costEstimate("rule-9", {})).toBe(DEFAULT_RULE_COST);
  });

  it("falls back to DEFAULT_RULE_COST for non-finite or non-positive weights", () => {
    expect(costEstimate("rule-9", { "rule-9": Number.NaN })).toBe(DEFAULT_RULE_COST);
    expect(costEstimate("rule-9", { "rule-9": Number.POSITIVE_INFINITY })).toBe(DEFAULT_RULE_COST);
    expect(costEstimate("rule-9", { "rule-9": 0 })).toBe(DEFAULT_RULE_COST);
    expect(costEstimate("rule-9", { "rule-9": -1 })).toBe(DEFAULT_RULE_COST);
  });
});
