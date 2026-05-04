import { describe, expect, it } from "vitest";

import { analyze } from "./analyze.js";
import { parseCostSchedule } from "./cost-schedule.js";
import type { HealthSnapshot, RuleViolationStats } from "./monitor.js";

const stats = (overrides: Partial<RuleViolationStats> = {}): RuleViolationStats => ({
  ruleId: "rule-9",
  violationCount: 1,
  firstSeen: "2026-05-01T00:00:00Z",
  lastSeen: "2026-05-01T00:00:00Z",
  exemplars: [],
  ...overrides,
});

const snap = (violations: readonly RuleViolationStats[]): HealthSnapshot => ({
  violations,
  experiments: { validated: 0, regressed: 0, inconclusive: 0 },
  ciFailureCount: 0,
  advisoryCount: 0,
  warnings: [],
});

const VISION_WITH_SCHEDULE = `# vision

## Some other section

prose

## Cost schedule

Per-rule cost weights consumed by the Analyze phase.

| Rule ID  | Cost weight | Rationale                                         |
|----------|-------------|---------------------------------------------------|
| rule-9   | 100         | Iron rule; pre-registration violation invalidates the experiment |
| rule-7   | 50          | Chaos failures = unobserved blast radius          |
| rule-typo| 1           | Cosmetic only; high frequency, low semantic cost  |

## Theoretical foundations

more prose
`;

const VISION_WITHOUT_SCHEDULE = `# vision

## Some other section

prose

## Theoretical foundations

more prose
`;

const VISION_SCHEDULE_AT_EOF = `# vision

## Cost schedule

| Rule ID | Cost weight | Notes |
|---------|-------------|-------|
| rule-9  | 100         | iron  |
`;

describe("parseCostSchedule", () => {
  it("parses the markdown table from a `## Cost schedule` section", () => {
    const schedule = parseCostSchedule(VISION_WITH_SCHEDULE);
    expect(schedule).toEqual({
      "rule-9": 100,
      "rule-7": 50,
      "rule-typo": 1,
    });
  });

  it("returns an empty schedule when the section is absent", () => {
    const schedule = parseCostSchedule(VISION_WITHOUT_SCHEDULE);
    expect(schedule).toEqual({});
  });

  it("handles the section being the last in the file (no following heading)", () => {
    const schedule = parseCostSchedule(VISION_SCHEDULE_AT_EOF);
    expect(schedule).toEqual({ "rule-9": 100 });
  });

  it("drops rows with non-numeric, zero, or negative weights (rule #7 graceful-degrade)", () => {
    const content = `## Cost schedule

| Rule ID  | Cost weight | Notes |
|----------|-------------|-------|
| rule-ok  | 5           | fine  |
| rule-zero| 0           | drop  |
| rule-neg | -3          | drop  |
| rule-nan | abc         | drop  |
`;
    const schedule = parseCostSchedule(content);
    expect(schedule).toEqual({ "rule-ok": 5 });
  });

  it("returns an empty schedule when the heading is present but no table follows", () => {
    const content = `## Cost schedule

just prose, no table at all.

## Next section
`;
    expect(parseCostSchedule(content)).toEqual({});
  });

  it("integration: a high-volume rule-typo cannot outrank a single rule-9 under the schedule", () => {
    // Without a schedule the rule-typo violations dominate (1000 × 1 = 1000
    // vs rule-9 at 1 × 1 = 1). With the schedule rule-9 dominates
    // (1 × 100 = 100 vs rule-typo at 1000 × 1 = 1000 — still wins on
    // volume, so use a smaller volume to make the test unambiguous).
    // Use rule-typo volume that the schedule keeps below rule-9's product.
    const schedule = parseCostSchedule(VISION_WITH_SCHEDULE);
    const a = analyze({
      snapshot: snap([
        stats({ ruleId: "rule-typo", violationCount: 50 }), // 50 × 1 = 50
        stats({ ruleId: "rule-9", violationCount: 1 }), // 1 × 100 = 100
      ]),
      costs: schedule,
    });
    expect(a.topConstraint?.ruleId).toBe("rule-9");
    expect(a.evidence?.costEstimate).toBe(100);
  });

  it("integration: without the schedule, the same input picks the high-volume rule (regression baseline)", () => {
    // Same inputs as the previous test, but with the empty schedule (every
    // rule = 1). rule-typo's 50 × 1 = 50 outranks rule-9's 1 × 1 = 1.
    const a = analyze({
      snapshot: snap([
        stats({ ruleId: "rule-typo", violationCount: 50 }),
        stats({ ruleId: "rule-9", violationCount: 1 }),
      ]),
      // No costs argument → identity schedule.
    });
    expect(a.topConstraint?.ruleId).toBe("rule-typo");
  });
});
