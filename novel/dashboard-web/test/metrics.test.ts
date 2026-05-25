import { describe, expect, it } from "vitest";

import { SUCCESS_METRICS } from "../src/metrics.js";

describe("SUCCESS_METRICS — vision.md success criteria + extension tiles", () => {
  it("contains a positive number of entries (live count, not a frozen literal)", () => {
    // The original 10 entries map to vision.md § "Success criteria" rows.
    // Extension tiles ship alongside as PRs land (e.g. `cross-repo-pr-rate`
    // in #790; `fleet-stability-aggregated` / `session-converts-repo` /
    // `baseline-delta-per-cycle` in PR `feat/m1-2-m1-7-collectors-from-transform-ledger`).
    // Counting from the live array prevents the assertion from rotting
    // every time a tile is added — the equivalent stale-literal bug
    // was just fixed in `scripts/check-metric-freshness.test.mjs`.
    expect(SUCCESS_METRICS.length).toBeGreaterThanOrEqual(10);
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

  it("wrist-dwell formula uses the named constant `estimated_dwell_seconds_per_request` (vision.md row 6)", () => {
    // vision.md § "Success criteria" row 6 expresses the dwell estimate as
    // `count(...) * estimated_dwell_seconds_per_request` (constant ≈ 2 s).
    // Inlining the literal `* 2` drifts silently from the spec — same drift
    // pattern as PR #67 (task-throughput formula alignment).
    const wristDwell = SUCCESS_METRICS.find((m) => m.id === "wrist-dwell");
    expect(wristDwell).toBeDefined();
    expect(wristDwell?.unit).toBe("seconds/day");
    expect(wristDwell?.formula).toContain("estimated_dwell_seconds_per_request");
  });
});
