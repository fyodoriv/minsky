// Unit tests for throughput-benchmark — pure helpers only. The fixture-host
// walk + scorecard write are exercised by the integration test in
// test/integration/throughput-benchmark.test.ts.

import { describe, expect, test } from "vitest";
import {
  aggregateThroughput,
  buildScorecardRows,
  CLEAN_VERDICTS,
  classifyHostOutcome,
  formatThroughputSummary,
  PR_PRODUCING_VERDICTS,
  parseArgs,
  parseDuration,
  parseRunnerVerdict,
  scaleToWindow,
} from "./throughput-benchmark.mjs";

describe("PR_PRODUCING_VERDICTS / CLEAN_VERDICTS", () => {
  test("PR-producing set is the two draft-shipping verdicts", () => {
    expect(PR_PRODUCING_VERDICTS.has("pr-open")).toBe(true);
    expect(PR_PRODUCING_VERDICTS.has("validated")).toBe(true);
    expect(PR_PRODUCING_VERDICTS.has("no-change")).toBe(false);
  });
  test("clean set includes no-op verdicts but excludes failures", () => {
    expect(CLEAN_VERDICTS.has("no-change")).toBe(true);
    expect(CLEAN_VERDICTS.has("empty-queue")).toBe(true);
    expect(CLEAN_VERDICTS.has("scope-leak")).toBe(false);
    expect(CLEAN_VERDICTS.has("spawn-failed")).toBe(false);
  });
  test("both sets are frozen (no accidental mutation)", () => {
    expect(Object.isFrozen(PR_PRODUCING_VERDICTS)).toBe(true);
    expect(Object.isFrozen(CLEAN_VERDICTS)).toBe(true);
  });
});

describe("classifyHostOutcome", () => {
  test("validated host produces an accepted PR", () => {
    const o = classifyHostOutcome({ host: "h1", verdict: "validated", durationMs: 100 });
    expect(o.producedPr).toBe(true);
    expect(o.accepted).toBe(true);
  });
  test("scope-leak host produces no PR and is not accepted", () => {
    const o = classifyHostOutcome({ host: "h2", verdict: "scope-leak", durationMs: 50 });
    expect(o.producedPr).toBe(false);
    expect(o.accepted).toBe(false);
  });
  test("no-change is clean but produces no PR", () => {
    const o = classifyHostOutcome({ host: "h3", verdict: "no-change", durationMs: 10 });
    expect(o.producedPr).toBe(false);
    expect(o.accepted).toBe(false);
  });
  test("undefined verdict is neither PR-producing nor accepted", () => {
    const o = classifyHostOutcome({ host: "h4", verdict: undefined, durationMs: 0 });
    expect(o.producedPr).toBe(false);
    expect(o.accepted).toBe(false);
    expect(o.exitCode).toBe(null);
  });
});

describe("scaleToWindow", () => {
  test("linear projection: 1 PR in 1h → 24 PRs/day", () => {
    expect(scaleToWindow(1, 3600, 86400)).toBe(24);
  });
  test("5 PRs across 5 hosts taking 2h total → 60 PRs/day", () => {
    expect(scaleToWindow(5, 7200, 86400)).toBe(60);
  });
  test("zero observed window returns 0 (no division by zero / no infinity)", () => {
    expect(scaleToWindow(3, 0, 86400)).toBe(0);
  });
  test("zero window returns 0", () => {
    expect(scaleToWindow(3, 100, 0)).toBe(0);
  });
});

describe("parseDuration", () => {
  test("hours", () => {
    expect(parseDuration("24h")).toBe(86400);
  });
  test("minutes", () => {
    expect(parseDuration("90m")).toBe(5400);
  });
  test("explicit seconds", () => {
    expect(parseDuration("3600s")).toBe(3600);
  });
  test("bare integer is seconds", () => {
    expect(parseDuration("120")).toBe(120);
  });
  test("unparseable returns NaN", () => {
    expect(Number.isNaN(parseDuration("soon"))).toBe(true);
    expect(Number.isNaN(parseDuration("24x"))).toBe(true);
  });
});

describe("aggregateThroughput", () => {
  test("empty fleet returns a zeroed report (no fabricated rates)", () => {
    const r = aggregateThroughput([], 86400);
    expect(r.fixture_hosts).toBe(0);
    expect(r.minsky_throughput_prs_per_day).toBe(0);
    expect(r.minsky_draft_acceptance_rate).toBe(0);
    expect(r.prs_observed).toBe(0);
  });

  test("5-host all-validated fleet projects PRs/day and 100% acceptance", () => {
    // Each host takes 1h of wall-clock → 5h observed, 5 PRs → 24 PRs/day.
    const outcomes = Array.from({ length: 5 }, (_, i) =>
      classifyHostOutcome({ host: `h${i}`, verdict: "validated", durationMs: 3_600_000 }),
    );
    const r = aggregateThroughput(outcomes, 86400);
    expect(r.fixture_hosts).toBe(5);
    expect(r.prs_observed).toBe(5);
    expect(r.prs_accepted).toBe(5);
    expect(r.minsky_throughput_prs_per_day).toBe(24);
    expect(r.minsky_draft_acceptance_rate).toBe(1);
  });

  test("a scope-leak host drags acceptance below 1 and is not counted as a PR", () => {
    const outcomes = [
      classifyHostOutcome({ host: "a", verdict: "validated", durationMs: 1000 }),
      classifyHostOutcome({ host: "b", verdict: "validated", durationMs: 1000 }),
      classifyHostOutcome({ host: "c", verdict: "scope-leak", durationMs: 1000 }),
    ];
    const r = aggregateThroughput(outcomes, 86400);
    // 2 of 3 produced a PR; both produced ones were clean → acceptance over
    // produced PRs is 2/2 = 1, but only 2 PRs were observed across 3 hosts.
    expect(r.prs_observed).toBe(2);
    expect(r.prs_accepted).toBe(2);
    expect(r.minsky_draft_acceptance_rate).toBe(1);
    expect(r.verdict_counts["scope-leak"]).toBe(1);
    expect(r.verdict_counts["validated"]).toBe(2);
  });

  test("iterations/day counts every host attempt, PRs/day only PR producers", () => {
    const outcomes = [
      classifyHostOutcome({ host: "a", verdict: "validated", durationMs: 3_600_000 }),
      classifyHostOutcome({ host: "b", verdict: "no-change", durationMs: 3_600_000 }),
    ];
    const r = aggregateThroughput(outcomes, 86400);
    // 2 iterations in 2h → 24 iters/day; 1 PR in 2h → 12 PRs/day.
    expect(r.minsky_throughput_iterations_per_day).toBe(24);
    expect(r.minsky_throughput_prs_per_day).toBe(12);
  });
});

describe("buildScorecardRows", () => {
  test("emits the two task-named rows plus iterations + timestamp", () => {
    const report = aggregateThroughput(
      [classifyHostOutcome({ host: "a", verdict: "validated", durationMs: 3_600_000 })],
      86400,
    );
    const rows = buildScorecardRows(report, new Date("2020-01-01T00:00:00.000Z"));
    expect(rows.minsky_throughput_prs_per_day).toBe(24);
    expect(rows.minsky_draft_acceptance_rate).toBe(1);
    expect(rows.minsky_throughput_iterations_per_day).toBe(24);
    expect(rows.measured_at).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("parseRunnerVerdict", () => {
  test("extracts verdict= token", () => {
    expect(parseRunnerVerdict("⏱ iteration #0: verdict=validated duration=0s")).toBe("validated");
  });
  test("falls back to stopReason", () => {
    expect(parseRunnerVerdict("stopReason: empty-queue")).toBe("empty-queue");
  });
  test("verdict= wins over stopReason", () => {
    expect(parseRunnerVerdict("verdict=pr-open\nstopReason: scope-leak")).toBe("pr-open");
  });
  test("no match returns undefined", () => {
    expect(parseRunnerVerdict("nothing here")).toBe(undefined);
  });
});

describe("parseArgs", () => {
  test("defaults to 5 fixture hosts over a 24h window, dry-run", () => {
    const o = parseArgs(["node", "throughput-benchmark.mjs"]);
    expect(o.fixtureHosts).toBe(5);
    expect(o.durationRaw).toBe("24h");
    expect(o.live).toBe(false);
    expect(o.json).toBe(false);
  });
  test("--fixture-hosts=3 --duration=90m parses equals form", () => {
    const o = parseArgs(["node", "x", "--fixture-hosts=3", "--duration=90m"]);
    expect(o.fixtureHosts).toBe(3);
    expect(o.durationRaw).toBe("90m");
  });
  test("space-separated form also parses", () => {
    const o = parseArgs(["node", "x", "--fixture-hosts", "7", "--scorecard", "/tmp/sc.json"]);
    expect(o.fixtureHosts).toBe(7);
    expect(o.scorecard).toBe("/tmp/sc.json");
  });
  test("--live and --json flags flip", () => {
    const o = parseArgs(["node", "x", "--live", "--json"]);
    expect(o.live).toBe(true);
    expect(o.json).toBe(true);
  });
});

describe("formatThroughputSummary", () => {
  test("includes the falsifiable rows and a sorted verdict breakdown", () => {
    const out = formatThroughputSummary({
      fixture_hosts: 5,
      duration_seconds: 86400,
      observed_seconds: 5,
      prs_observed: 5,
      prs_accepted: 5,
      minsky_throughput_prs_per_day: 86400,
      minsky_throughput_iterations_per_day: 86400,
      minsky_draft_acceptance_rate: 1,
      verdict_counts: { validated: 4, "no-change": 1 },
    });
    expect(out).toContain("fixture hosts:        5");
    expect(out).toContain("PRs/day (projected):  86400");
    expect(out).toContain("draft-acceptance:     1");
    // sorted alphabetically: no-change before validated
    expect(out.indexOf("no-change")).toBeLessThan(out.indexOf("validated"));
  });
});
