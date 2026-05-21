// Tests for generate-metrics-md.mjs. Pattern: paired positive/negative
// fixtures over a pure builder (Meszaros 2007), rule #10 — same input,
// same output. Mirrors `generate-changelog-entry.test.mjs`.

import { describe, expect, test } from "vitest";

import { buildMetricsMd, classifyFreshness } from "./generate-metrics-md.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const sampleMetric = {
  id: "loop-uptime",
  label: "Loop uptime, 30 / 90 / 365 d",
  formula: "systemctl --user is-active minsky-tick-loop",
  unit: "fraction",
  freshnessBudgetMs: 7 * DAY_MS,
  goal: "99% / 97% / 95% (30 / 90 / 365 d)",
  pivot: "<90% over 30 d → reconsider supervisor design",
  anchor: "Beyer et al., _SRE_ 2016, Ch. 4 (SLI / SLO)",
};

const monotonicMetric = {
  id: "extraction-count",
  label: "Extraction count",
  formula: "gh repo list fyodoriv ...",
  unit: "count",
  freshnessBudgetMs: 30 * DAY_MS,
  /** @type {"ok"} */
  monotonic: "ok",
  goal: "≥4 OSS repos extracted by month 6",
  pivot: "<2 by month 4 → re-evaluate extraction policy / scope",
  anchor: "rule #1 (don't reinvent the wheel)",
};

const NOW = Date.UTC(2026, 4, 5, 12, 0, 0);

describe("classifyFreshness", () => {
  test("missing observation → 'missing'", () => {
    expect(classifyFreshness(sampleMetric, undefined, NOW)).toBe("missing");
  });

  test("observation taken now → 'fresh'", () => {
    expect(classifyFreshness(sampleMetric, { value: 0.99, timestampMs: NOW }, NOW)).toBe("fresh");
  });

  test("observation taken exactly at the budget edge → 'fresh' (inclusive)", () => {
    const obs = { value: 0.99, timestampMs: NOW - sampleMetric.freshnessBudgetMs };
    expect(classifyFreshness(sampleMetric, obs, NOW)).toBe("fresh");
  });

  test("observation older than the budget → 'stale'", () => {
    const obs = { value: 0.99, timestampMs: NOW - sampleMetric.freshnessBudgetMs - 1 };
    expect(classifyFreshness(sampleMetric, obs, NOW)).toBe("stale");
  });

  test("future-timestamped observation → 'fresh' (lint catches absurd values, not us)", () => {
    const obs = { value: 0.99, timestampMs: NOW + DAY_MS };
    expect(classifyFreshness(sampleMetric, obs, NOW)).toBe("fresh");
  });
});

describe("buildMetricsMd — header", () => {
  test("renders the canonical title", () => {
    const out = buildMetricsMd({ metrics: [], nowMs: NOW });
    expect(out).toContain("# METRICS.md — canonical observability surface");
  });

  test("preamble cites Ries 2011 to anchor the no-silent-zero discipline", () => {
    const out = buildMetricsMd({ metrics: [], nowMs: NOW });
    expect(out).toContain("Ries 2011");
  });
});

describe("buildMetricsMd — fresh observations", () => {
  test("renders value and unit when observation is fresh", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      observations: { "loop-uptime": { value: 0.97, timestampMs: NOW } },
      nowMs: NOW,
    });
    expect(out).toContain("**Value:** 0.97 fraction");
    expect(out).not.toContain("**Value:** (stub)");
  });

  test("renders an `_Updated:` line with iso UTC second-precision timestamp", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      observations: { "loop-uptime": { value: 0.97, timestampMs: NOW } },
      nowMs: NOW,
    });
    expect(out).toContain("_Updated: 2026-05-05T12:00:00Z");
  });

  test("renders the optional Source field when present", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      observations: {
        "loop-uptime": { value: 0.97, timestampMs: NOW, source: "scripts/uptime.mjs" },
      },
      nowMs: NOW,
    });
    expect(out).toContain("Source: `scripts/uptime.mjs`");
  });

  test("renders the freshness budget so the reader sees the staleness threshold", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      observations: { "loop-uptime": { value: 0.97, timestampMs: NOW } },
      nowMs: NOW,
    });
    expect(out).toContain("Budget: 7d");
  });
});

describe("buildMetricsMd — stub fallback (acceptance criterion 4)", () => {
  test("missing observation → explicit `(stub)` with follow-up pointer", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).toContain("**Value:** (stub) — no observation captured yet");
    expect(out).toContain("wired in canonical-metric-list-per-repo follow-up");
  });

  test("stale observation → `(stub)` with budget reason (not a silent old value)", () => {
    const stale = { value: 0.5, timestampMs: NOW - sampleMetric.freshnessBudgetMs - 1 };
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      observations: { "loop-uptime": stale },
      nowMs: NOW,
    });
    expect(out).toContain("(stub) — last observation older than 7d budget");
    expect(out).not.toContain("**Value:** 0.5");
  });

  test("custom stubFollowUp pointer overrides the default", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      nowMs: NOW,
      stubFollowUp: "PR #999 wires this",
    });
    expect(out).toContain("(PR #999 wires this)");
  });
});

describe("buildMetricsMd — monotonic flag", () => {
  test("monotonic-flagged metrics render the `monotonic: ok` annotation in the meta line", () => {
    const out = buildMetricsMd({ metrics: [monotonicMetric], nowMs: NOW });
    expect(out).toContain("monotonic: ok");
  });

  test("non-monotonic metrics do NOT render the annotation (so the reader notices when it appears)", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).not.toContain("monotonic");
  });
});

describe("buildMetricsMd — section structure", () => {
  test("emits one `## <id>` heading per metric", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric, monotonicMetric], nowMs: NOW });
    const headings = out.match(/^## /gm) ?? [];
    expect(headings).toHaveLength(2);
  });

  test("renders metric formula in a backtick-fenced one-liner under 'How to view'", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).toContain("**How to view:** `systemctl --user is-active minsky-tick-loop`");
  });

  test("renders Goal / Pivot / Anchor for every metric (operator directive 2026-05-21)", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).toContain("**Goal:** 99% / 97% / 95% (30 / 90 / 365 d)");
    expect(out).toContain("**Pivot:** <90% over 30 d → reconsider supervisor design");
    expect(out).toContain("**Anchor:** Beyer et al., _SRE_ 2016, Ch. 4 (SLI / SLO)");
  });

  test("throws when goal is empty string (TypeScript-allows-empty bypass guard, operator directive 2026-05-21)", () => {
    const broken = { ...sampleMetric, goal: "" };
    expect(() => buildMetricsMd({ metrics: [broken], nowMs: NOW })).toThrow(
      /empty or non-string goal/,
    );
  });

  test("throws when pivot is whitespace-only string", () => {
    const broken = { ...sampleMetric, pivot: "   " };
    expect(() => buildMetricsMd({ metrics: [broken], nowMs: NOW })).toThrow(
      /empty or non-string pivot/,
    );
  });

  test("throws when anchor is empty string", () => {
    const broken = { ...sampleMetric, anchor: "" };
    expect(() => buildMetricsMd({ metrics: [broken], nowMs: NOW })).toThrow(
      /empty or non-string anchor/,
    );
  });

  test("error message names the metric ID so the operator knows which one to fix", () => {
    const broken = { ...sampleMetric, id: "supervisor-uptime", goal: "" };
    expect(() => buildMetricsMd({ metrics: [broken], nowMs: NOW })).toThrow(/'supervisor-uptime'/);
  });

  test("renders milestone tag when present", () => {
    const m = { ...sampleMetric, milestone: "M1.1" };
    const out = buildMetricsMd({ metrics: [m], nowMs: NOW });
    expect(out).toContain("Milestone: M1.1");
  });

  test("does not render milestone tag when absent (back-compat)", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).not.toContain("Milestone:");
  });
});

describe("buildMetricsMd — 'Metrics to add' section", () => {
  /** @type {import("./generate-metrics-md.mjs").ProposedMetricLike} */
  const sampleProposed = {
    id: "swe-bench-resolve-rate",
    label: "SWE-bench Verified resolve rate",
    rationale: "M2.7 acceptance: resolve rate vs. competitors.",
    milestone: "M2.7",
    blockedBy: "self-metrics-competitive-benchmark",
    formula: "minsky benchmark --swe-bench-subset",
  };

  test("renders a 'Metrics to add' h2 when proposedMetrics is non-empty", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      proposedMetrics: [sampleProposed],
      nowMs: NOW,
    });
    expect(out).toContain("## Metrics to add");
    expect(out).toContain("### swe-bench-resolve-rate — SWE-bench Verified resolve rate");
  });

  test("renders the proposed metric's rationale + future-formula", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      proposedMetrics: [sampleProposed],
      nowMs: NOW,
    });
    expect(out).toContain("**Why it belongs:** M2.7 acceptance: resolve rate vs. competitors.");
    expect(out).toContain("**Future formula:** `minsky benchmark --swe-bench-subset`");
  });

  test("renders the blocker task when present", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      proposedMetrics: [sampleProposed],
      nowMs: NOW,
    });
    expect(out).toContain("**Blocked by:** `self-metrics-competitive-benchmark` in `TASKS.md`.");
  });

  test("omits the 'Metrics to add' section when proposedMetrics is empty / absent", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).not.toContain("## Metrics to add");
  });

  test("renders the proposed metric's milestone tag", () => {
    const out = buildMetricsMd({
      metrics: [sampleMetric],
      proposedMetrics: [sampleProposed],
      nowMs: NOW,
    });
    expect(out).toContain("_Milestone: M2.7_");
  });

  test("preserves the order of the input metrics array", () => {
    const out = buildMetricsMd({ metrics: [monotonicMetric, sampleMetric], nowMs: NOW });
    const monoIdx = out.indexOf("extraction-count");
    const upIdx = out.indexOf("loop-uptime");
    expect(monoIdx).toBeGreaterThan(-1);
    expect(upIdx).toBeGreaterThan(-1);
    expect(monoIdx).toBeLessThan(upIdx);
  });
});

describe("buildMetricsMd — determinism", () => {
  test("same input → same output (rule #10)", () => {
    const input = {
      metrics: [sampleMetric, monotonicMetric],
      observations: { "loop-uptime": { value: 0.97, timestampMs: NOW } },
      nowMs: NOW,
    };
    expect(buildMetricsMd(input)).toBe(buildMetricsMd(input));
  });
});
