// Tests for generate-changelog-entry.mjs. Pattern: paired positive/negative
// fixtures over a pure builder (Meszaros 2007), rule #10 — same input,
// same output, asserted byte-for-byte where it makes sense.

import { describe, expect, test } from "vitest";

import {
  buildChangelogEntry,
  buildChangelogJson,
  classifyDirection,
  synthesizeNarrative,
} from "./generate-changelog-entry.mjs";

const baseDate = "2026-05-05";
const samplePR = {
  number: 174,
  title: "fix(tick-loop): real daemon brief",
  additions: 156,
  deletions: 4,
};

describe("classifyDirection", () => {
  test("higher-is-better, positive delta → improved", () => {
    expect(classifyDirection(42, true)).toBe("improved");
  });

  test("higher-is-better, negative delta → regressed", () => {
    expect(classifyDirection(-7, true)).toBe("regressed");
  });

  test("lower-is-better (self-diagnose findings), negative delta → improved", () => {
    expect(classifyDirection(-1, false)).toBe("improved");
  });

  test("lower-is-better, positive delta → regressed", () => {
    expect(classifyDirection(3, false)).toBe("regressed");
  });

  test("zero delta → unchanged regardless of direction", () => {
    expect(classifyDirection(0, true)).toBe("unchanged");
    expect(classifyDirection(0, false)).toBe("unchanged");
  });
});

describe("synthesizeNarrative", () => {
  test("empty PR list → no-PRs sentinel", () => {
    expect(synthesizeNarrative([])).toBe("No PRs merged today.");
  });

  test("single PR → single-PR sentence with title", () => {
    const text = synthesizeNarrative([samplePR]);
    expect(text).toBe("Single PR shipped: fix(tick-loop): real daemon brief.");
  });

  test("many PRs → enumerates with #numbers", () => {
    const text = synthesizeNarrative([
      samplePR,
      { number: 175, title: "feat: wrapper", additions: 200, deletions: 0 },
    ]);
    expect(text).toContain("2 PRs shipped today");
    expect(text).toContain("#174");
    expect(text).toContain("#175");
  });
});

describe("buildChangelogEntry", () => {
  test("renders the date as a level-2 heading", () => {
    const out = buildChangelogEntry({ date: baseDate, mergedPRs: [samplePR] });
    expect(out).toContain(`## ${baseDate}`);
  });

  test("renders a PR bullet with +additions/-deletions", () => {
    const out = buildChangelogEntry({ date: baseDate, mergedPRs: [samplePR] });
    expect(out).toContain("- **#174** — `fix(tick-loop): real daemon brief` _(+156/-4)_");
  });

  test("renders the daemon-authored tag when flag is set", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [{ ...samplePR, daemonAuthored: true }],
    });
    expect(out).toContain("— _daemon-authored_");
  });

  test("renders an optional summary as a blockquote line", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [{ ...samplePR, summary: "structural unblock for the loop" }],
    });
    expect(out).toContain("> structural unblock for the loop");
  });

  test("no merged PRs → renders the empty-day sentinel", () => {
    const out = buildChangelogEntry({ date: baseDate, mergedPRs: [] });
    expect(out).toContain("_No PRs merged on this date._");
  });

  test("metrics with prev snapshot get Δ + direction labels", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { uptime_h: { value: 10, higherIsBetter: true } },
      prevMetricsSnapshot: { uptime_h: { value: 7, higherIsBetter: true } },
    });
    expect(out).toContain("**uptime_h**: 7 → 10 _(Δ +3, **improved**)_");
  });

  test("lower-is-better metric drop is labelled improved", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { findings: { value: 0, higherIsBetter: false } },
      prevMetricsSnapshot: { findings: { value: 1, higherIsBetter: false } },
    });
    expect(out).toContain("**findings**: 1 → 0 _(Δ -1, **improved**)_");
  });

  test("metric with no prev snapshot renders without a Δ", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { brand_new: { value: 42 } },
    });
    expect(out).toContain("**brand_new**: 42");
    expect(out).not.toMatch(/brand_new.*Δ/);
  });

  test("unchanged metric renders 'unchanged' label", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { steady: { value: 5, higherIsBetter: true } },
      prevMetricsSnapshot: { steady: { value: 5, higherIsBetter: true } },
    });
    expect(out).toContain("**steady**: 5 → 5 _(Δ 0, **unchanged**)_");
  });

  test("custom format hook is honoured for value AND delta", () => {
    /** @type {(n: number) => string} */
    const billions = (n) => `${(n / 1e9).toFixed(2)}B`;
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { tokens: { value: 1.99e9, higherIsBetter: true, format: billions } },
      prevMetricsSnapshot: { tokens: { value: 1.5e9, higherIsBetter: true, format: billions } },
    });
    expect(out).toContain("**tokens**: 1.50B → 1.99B _(Δ +0.49B, **improved**)_");
  });

  test("narrativeOverride replaces the auto-synthesised paragraph", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [samplePR],
      narrativeOverride: "The day the loop started compounding.",
    });
    expect(out).toContain("The day the loop started compounding.");
    expect(out).not.toContain("Single PR shipped");
  });

  test("PR ordering is preserved (caller controls sort)", () => {
    const out = buildChangelogEntry({
      date: baseDate,
      mergedPRs: [
        { number: 175, title: "second", additions: 1, deletions: 0 },
        { number: 174, title: "first", additions: 1, deletions: 0 },
      ],
    });
    expect(out.indexOf("#175")).toBeLessThan(out.indexOf("#174"));
  });

  test("output is deterministic — same input renders identical bytes", () => {
    const input = {
      date: baseDate,
      mergedPRs: [samplePR],
      metricsSnapshot: { uptime: { value: 10, higherIsBetter: true } },
      prevMetricsSnapshot: { uptime: { value: 7, higherIsBetter: true } },
    };
    expect(buildChangelogEntry(input)).toBe(buildChangelogEntry(input));
  });
});

describe("buildChangelogJson", () => {
  test("structured shape exposes mergedPRs.length for the rule-#9 measurement", () => {
    const json = buildChangelogJson({ date: baseDate, mergedPRs: [samplePR] });
    expect(json.mergedPRs).toHaveLength(1);
    expect(json.mergedPRs[0]).toMatchObject({ number: 174, daemonAuthored: false, summary: null });
  });

  test("metrics array carries delta + direction when prev snapshot present", () => {
    const json = buildChangelogJson({
      date: baseDate,
      mergedPRs: [],
      metricsSnapshot: { findings: { value: 0, higherIsBetter: false } },
      prevMetricsSnapshot: { findings: { value: 2, higherIsBetter: false } },
    });
    expect(json.metrics[0]).toMatchObject({
      name: "findings",
      value: 0,
      prev: 2,
      delta: -2,
      direction: "improved",
      higherIsBetter: false,
    });
  });

  test("narrativeOverridden flag is true iff override was supplied", () => {
    const withOverride = buildChangelogJson({
      date: baseDate,
      mergedPRs: [],
      narrativeOverride: "x",
    });
    const without = buildChangelogJson({ date: baseDate, mergedPRs: [] });
    expect(withOverride.narrativeOverridden).toBe(true);
    expect(without.narrativeOverridden).toBe(false);
  });
});
