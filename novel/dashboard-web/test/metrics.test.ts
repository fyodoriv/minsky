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

  it("task-throughput formula divides 30-day count by 30 (vision.md row 10 — `tasks/day`)", () => {
    // vision.md § "Success criteria" row 10 specifies the 30-day count
    // divided by 30 to convert to tasks/day. Without `/ 30` the dashboard
    // renders a 30× over-read once OTEL wiring lands.
    const taskThroughput = SUCCESS_METRICS.find((m) => m.id === "task-throughput");
    expect(taskThroughput).toBeDefined();
    expect(taskThroughput?.unit).toBe("tasks/day");
    expect(taskThroughput?.formula).toContain("/ 30");
  });
});
