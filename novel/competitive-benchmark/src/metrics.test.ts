import { describe, expect, it } from "vitest";

// Import through the package barrel so `index.ts` (a pure re-export) is
// covered by the same suite — mirrors `novel/adapters/types/src/index.test.ts`.
import {
  METRICS,
  type MetricDefinition,
  compareValues,
  computeDelta,
  metricById,
} from "./index.js";

describe("METRICS catalogue", () => {
  it("ships ≥5 metrics across all three families (slice-(c) success bar)", () => {
    expect(METRICS.length).toBeGreaterThanOrEqual(5);
    const categories = new Set(METRICS.map((m) => m.category));
    expect([...categories].sort()).toEqual(["agentic", "dora", "public-benchmark"]);
  });

  it("includes the four DORA keys", () => {
    const dora = METRICS.filter((m) => m.category === "dora").map((m) => m.id);
    expect(dora.sort()).toEqual([
      "change-fail-rate",
      "deploy-frequency",
      "lead-time-for-changes",
      "mttr",
    ]);
  });

  it("includes both public-benchmark hooks (SWE-bench for agents, HumanEval for orchestrators)", () => {
    // 2026-05-23: corpus widened to orchestrator-tier competitors per operator
    // directive. SWE-bench is the agent-tier head-to-head; HumanEval is the
    // orchestrator-tier head-to-head (MetaGPT/AutoGen/CrewAI/LangGraph publish
    // it). Both metrics live in the public-benchmark category — they don't
    // compete with each other, they cover different tiers.
    const pub = METRICS.filter((m) => m.category === "public-benchmark");
    expect(pub).toHaveLength(2);
    const ids = pub.map((m) => m.id).sort();
    expect(ids).toEqual(["humaneval-pass-at-1", "swe-bench-verified-resolve-rate"]);
  });

  it("has unique kebab-case ids", () => {
    const ids = METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every metric carries a non-empty primary-source anchor and description", () => {
    for (const m of METRICS) {
      expect(m.anchor.length).toBeGreaterThan(10);
      expect(m.description.length).toBeGreaterThan(10);
      expect(["higher-is-better", "lower-is-better"]).toContain(m.direction);
      expect(["count-per-day", "seconds", "ratio", "usd"]).toContain(m.unit);
    }
  });
});

describe("metricById", () => {
  it("resolves a known id", () => {
    expect(metricById("autonomous-merge-rate")?.label).toBe("Autonomous merge rate");
  });

  it("returns undefined for an unknown id", () => {
    expect(metricById("not-a-metric")).toBeUndefined();
  });

  it("includes daemon-stability-pct (M1.1 reliability SLI)", () => {
    // 2026-05-24: added to close out `single-stability-number` P0 task — the
    // operator's headline reliability number is now a first-class row in the
    // competitive scorecard. M1.1 gates on this at ≥0.90.
    const m = metricById("daemon-stability-pct");
    expect(m).toBeDefined();
    expect(m?.category).toBe("agentic");
    expect(m?.unit).toBe("ratio");
    expect(m?.direction).toBe("higher-is-better");
    expect(m?.label).toContain("Daemon stability");
    expect(m?.anchor).toContain("Beyer");
    expect(m?.description).toContain("≥0.90");
  });
});

const higher: MetricDefinition = {
  id: "h",
  label: "H",
  category: "agentic",
  unit: "ratio",
  direction: "higher-is-better",
  anchor: "test anchor citation",
  description: "test description text",
};
const lower: MetricDefinition = { ...higher, id: "l", direction: "lower-is-better" };

describe("compareValues", () => {
  it("ranks higher-is-better correctly", () => {
    expect(compareValues(higher, 0.9, 0.5)).toBe(1);
    expect(compareValues(higher, 0.5, 0.9)).toBe(-1);
  });

  it("ranks lower-is-better correctly", () => {
    expect(compareValues(lower, 10, 30)).toBe(1);
    expect(compareValues(lower, 30, 10)).toBe(-1);
  });

  it("returns 0 on an exact tie regardless of direction", () => {
    expect(compareValues(higher, 0.5, 0.5)).toBe(0);
    expect(compareValues(lower, 0.5, 0.5)).toBe(0);
  });
});

describe("computeDelta", () => {
  it("is positive when minsky is ahead (higher-is-better)", () => {
    expect(computeDelta(higher, 0.9, 0.6)).toBeCloseTo(0.3);
  });

  it("is negative when minsky is behind (higher-is-better)", () => {
    expect(computeDelta(higher, 0.6, 0.9)).toBeCloseTo(-0.3);
  });

  it("is positive when minsky is ahead (lower-is-better)", () => {
    // minsky cheaper/faster → ahead → positive
    expect(computeDelta(lower, 10, 25)).toBeCloseTo(15);
  });

  it("is negative when minsky is behind (lower-is-better)", () => {
    expect(computeDelta(lower, 25, 10)).toBeCloseTo(-15);
  });

  it("is zero on parity", () => {
    expect(computeDelta(higher, 1, 1)).toBe(0);
    expect(computeDelta(lower, 1, 1)).toBe(-0);
  });
});
