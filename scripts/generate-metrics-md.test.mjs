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
};

const monotonicMetric = {
  id: "extraction-count",
  label: "Extraction count",
  formula: "gh repo list fyodoriv ...",
  unit: "count",
  freshnessBudgetMs: 30 * DAY_MS,
  /** @type {"ok"} */
  monotonic: "ok",
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

  test("renders metric formula in a backtick-fenced one-liner", () => {
    const out = buildMetricsMd({ metrics: [sampleMetric], nowMs: NOW });
    expect(out).toContain("Formula: `systemctl --user is-active minsky-tick-loop`");
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
