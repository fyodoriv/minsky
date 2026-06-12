// Tests for metrics-render.mjs. Pattern: paired positive/negative
// fixtures over the pure orchestrator (Meszaros 2007; rule #10 — same
// input, same output). The CLI binding's I/O surface is not under
// test — those seams are covered by `metric-snapshot-store.test.mjs`
// and `generate-metrics-md.test.mjs`. End-to-end contract: this slice
// pipes those two pure modules together correctly.

import { describe, expect, test } from "vitest";

import {
  DEFAULT_OUTPUT_RELATIVE,
  dateToMidnightUtcMs,
  extractPriorRawValues,
  mapSnapshotToObservations,
  runMetricsRender,
} from "./metrics-render.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** @type {ReadonlyArray<import("./generate-metrics-md.mjs").SuccessMetricLike>} */
const FIXTURE_METRICS = [
  {
    id: "loop-uptime",
    label: "Loop uptime",
    formula: "echo 0",
    unit: "fraction",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "99% / 97% / 95% (30 / 90 / 365 d)",
    pivot: "<90% over 30 d → reconsider supervisor design",
    anchor: "Beyer et al., _SRE_ 2016, Ch. 4",
  },
  {
    id: "task-throughput",
    label: "Task throughput",
    formula: "echo 0",
    unit: "tasks/day",
    freshnessBudgetMs: 7 * DAY_MS,
    goal: "≥1 task / day at green budget",
    pivot: "<1 / day for 14 d at green budget",
    anchor: "Goldratt TOC",
  },
  {
    id: "extraction-count",
    label: "Extraction count",
    formula: "echo 0",
    unit: "count",
    freshnessBudgetMs: 30 * DAY_MS,
    monotonic: "ok",
    goal: "≥4 OSS repos by month 6",
    pivot: "<2 by month 4",
    anchor: "rule #1 (don't reinvent)",
  },
];

const NOW = Date.UTC(2026, 4, 5, 12, 0, 0);
const SNAPSHOT_TS = Date.UTC(2026, 4, 5, 0, 0, 0);

describe("dateToMidnightUtcMs", () => {
  test("happy-path date returns midnight UTC", () => {
    expect(dateToMidnightUtcMs("2026-05-05")).toBe(Date.UTC(2026, 4, 5, 0, 0, 0));
  });

  test("rejects non-YYYY-MM-DD shape", () => {
    expect(() => dateToMidnightUtcMs("2026/05/05")).toThrow(/expected YYYY-MM-DD/);
  });

  test("rejects regex-matching but non-real calendar date", () => {
    expect(() => dateToMidnightUtcMs("2026-02-30")).toThrow(/not a real calendar date/);
  });

  test("rejects month > 12 even when the regex passes", () => {
    expect(() => dateToMidnightUtcMs("2026-13-01")).toThrow();
  });
});

describe("mapSnapshotToObservations", () => {
  test("undefined snapshot → empty observations (graceful-degrade pre-instrumentation)", () => {
    const obs = mapSnapshotToObservations({
      snapshot: undefined,
      metricIds: ["loop-uptime", "task-throughput"],
      timestampMs: SNAPSHOT_TS,
    });
    expect(obs).toEqual({});
  });

  test("only ids present in BOTH snapshot AND metricIds produce observations", () => {
    const obs = mapSnapshotToObservations({
      snapshot: {
        "task-throughput": { value: 3.4 },
        // `open_prs` is not in metricIds — must be filtered out (current
        // changelog snapshots carry this id; render must not surface it
        // as an unexpected metric, that's a freshness-lint drift signal).
        open_prs: { value: 7 },
      },
      metricIds: ["loop-uptime", "task-throughput"],
      timestampMs: SNAPSHOT_TS,
    });
    expect(Object.keys(obs)).toEqual(["task-throughput"]);
    expect(obs["task-throughput"]).toEqual({
      value: 3.4,
      timestampMs: SNAPSHOT_TS,
    });
  });

  test("source is plumbed through when supplied", () => {
    const obs = mapSnapshotToObservations({
      snapshot: { "task-throughput": { value: 1 } },
      metricIds: ["task-throughput"],
      timestampMs: SNAPSHOT_TS,
      source: ".minsky/metric-snapshots/2026-05-05.json",
    });
    expect(obs["task-throughput"]?.source).toBe(".minsky/metric-snapshots/2026-05-05.json");
  });

  test("empty metricIds list yields no observations even when snapshot is non-empty", () => {
    const obs = mapSnapshotToObservations({
      snapshot: { foo: { value: 1 } },
      metricIds: [],
      timestampMs: SNAPSHOT_TS,
    });
    expect(obs).toEqual({});
  });

  test("higherIsBetter metadata is dropped — render contract takes only value+ts+source", () => {
    const obs = mapSnapshotToObservations({
      snapshot: { "task-throughput": { value: 1, higherIsBetter: false } },
      metricIds: ["task-throughput"],
      timestampMs: SNAPSHOT_TS,
    });
    expect(obs["task-throughput"]).not.toHaveProperty("higherIsBetter");
  });
});

describe("runMetricsRender — pipeline", () => {
  test("undefined snapshot → all sections render as explicit `(stub)`", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
    });
    // One stub per metric — visible-not-silent (Helland 2007).
    expect(md).toContain("## loop-uptime — Loop uptime");
    expect(md).toContain("**Value:** (stub) — no observation captured yet");
    expect(md).toContain("## task-throughput — Task throughput");
    expect(md).toContain("## extraction-count — Extraction count");
    // No `_Updated:` line on stubs.
    expect(md).not.toContain("_Updated:");
  });

  test("snapshot with one aligned id renders a fresh observation, others stay stubs", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: { "task-throughput": { value: 3.4 } },
      snapshotTimestampMs: SNAPSHOT_TS,
      snapshotSource: ".minsky/metric-snapshots/2026-05-05.json",
      nowMs: NOW,
    });
    expect(md).toContain("**Value:** 3.4 tasks/day");
    expect(md).toContain("_Updated: 2026-05-05T00:00:00Z · Budget: 7d");
    expect(md).toContain("Source: `.minsky/metric-snapshots/2026-05-05.json`");
    // Other two still stubs.
    const stubMatches = md.match(/\*\*Value:\*\* \(stub\)/g) ?? [];
    expect(stubMatches).toHaveLength(2);
  });

  test("snapshot with all aligned ids renders all-fresh document (no stubs)", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: {
        "loop-uptime": { value: 0.97 },
        "task-throughput": { value: 3.4 },
        "extraction-count": { value: 12 },
      },
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
    });
    // Preamble copy mentions `(stub)` as a literal — the assertion has
    // to scope to the per-section value lines, not the document text.
    expect(md).not.toContain("**Value:** (stub)");
    expect(md).toContain("**Value:** 0.97 fraction");
    expect(md).toContain("**Value:** 3.4 tasks/day");
    expect(md).toContain("**Value:** 12 count");
    // monotonic tag preserved on extraction-count.
    expect(md).toContain("_monotonic: ok_");
  });

  test("stale snapshot (timestamp older than budget) renders as `(stub)` not silent fresh", () => {
    const elevenDaysAgo = NOW - 11 * DAY_MS;
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      // task-throughput has a 7d budget — 11d-old observation is stale.
      snapshot: { "task-throughput": { value: 3.4 } },
      snapshotTimestampMs: elevenDaysAgo,
      nowMs: NOW,
    });
    expect(md).toContain("## task-throughput");
    // Stale → stub branch with the explicit "older than budget" reason
    // (the pure builder's `freshness === "stale"` path).
    expect(md).toMatch(/task-throughput[\s\S]*?\(stub\) — last observation older than/);
  });

  test("custom stubFollowUp pointer flows into all stub sections", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      stubFollowUp: "wired in #999",
    });
    const matches = md.match(/wired in #999/g) ?? [];
    expect(matches.length).toBe(FIXTURE_METRICS.length);
  });

  test("preamble + section count match metric count (no orphans, no duplicates)", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
    });
    const headings = md.match(/^## /gm) ?? [];
    expect(headings).toHaveLength(FIXTURE_METRICS.length);
    expect(md).toMatch(/^# METRICS\.md/);
  });

  test("ids absent from metricIds in snapshot are silently ignored (drift not a render failure)", () => {
    // Drift detection is the freshness lint's job (`--expected`), not
    // this renderer's. The render must remain pure; the lint is the
    // gate. Belt-and-suspenders separation (rule #10).
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: {
        "task-throughput": { value: 3.4 },
        unexpected_id: { value: 999 },
      },
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
    });
    expect(md).toContain("3.4");
    expect(md).not.toContain("unexpected_id");
    expect(md).not.toContain("999");
  });
});

describe("extractPriorRawValues", () => {
  test("empty / non-string input → empty map (genesis-safe)", () => {
    expect(extractPriorRawValues("")).toEqual({});
    // @ts-expect-error — non-string defensive branch
    expect(extractPriorRawValues(undefined)).toEqual({});
  });

  test("a document with one fresh + one stub section returns BOTH raw values verbatim", () => {
    const doc = [
      "# METRICS.md — canonical observability surface",
      "",
      "preamble blah blah",
      "",
      "## loop-uptime — Loop uptime",
      "",
      "_Updated: 2026-05-29T00:00:00Z · Budget: 7d_",
      "",
      "**Value:** 11% (27/238 validated iterations over 30d) fraction",
      "",
      "**How to view:** `cmd`",
      "",
      "## task-throughput — Task throughput",
      "",
      "_Budget: 7d_",
      "",
      "**Value:** (stub) — no observation captured yet (follow-up)",
      "",
      "**How to view:** `cmd`",
    ].join("\n");
    const raw = extractPriorRawValues(doc);
    expect(raw["loop-uptime"]).toBe("11% (27/238 validated iterations over 30d) fraction");
    expect(raw["task-throughput"]).toBe("(stub) — no observation captured yet (follow-up)");
  });

  test("section without a `**Value:**` line is silently skipped", () => {
    const doc = ["# header", "", "## loop-uptime — Loop uptime", "", "no value line here"].join(
      "\n",
    );
    expect(extractPriorRawValues(doc)).toEqual({});
  });

  test("preamble's literal `## ` does not produce a ghost entry", () => {
    // Older preambles literally embedded `## ` in prose. The split slice
    // skips the first chunk; this just pins the contract.
    const doc = ["# header", "", "This sentence mentions `## something` literally.", ""].join("\n");
    expect(extractPriorRawValues(doc)).toEqual({});
  });
});

describe("runMetricsRender — prior-value carry-forward (real → stub overwrite guard)", () => {
  // Regression for the live 2026-06-03 incident: a daemon regen with a
  // non-`SUCCESS_METRICS`-aligned snapshot id namespace produced an
  // all-stub `docs/METRICS.md` and flipped milestone-alignment from
  // 14/14 to 5/14, wedging every push on the pre-push fast gate. The
  // CLI now reads the prior file and threads its `**Value:**` lines as
  // `priorRawValues` so a no-fresh-observation regen carries the
  // committed values forward rather than overwriting them.

  test("empty snapshot + prior real values → carry-forward (no real → stub downgrade)", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      priorRawValues: {
        "loop-uptime": "11% (27/238 validated iterations over 30d) fraction",
        "task-throughput": "28.9 commits/day (866 in 30d) tasks/day",
        "extraction-count": "1 count",
      },
    });
    expect(md).toContain("**Value:** 11% (27/238 validated iterations over 30d) fraction");
    expect(md).toContain("**Value:** 28.9 commits/day (866 in 30d) tasks/day");
    expect(md).toContain("**Value:** 1 count");
    expect(md).not.toContain("**Value:** (stub)");
  });

  test("non-aligned snapshot ids + prior real values → still carry-forward (mirrors the live incident)", () => {
    // Snapshot exists but its keys (`active-days`, `pr-rate`) don't map
    // to any SUCCESS_METRICS id — the all-stub regen scenario. With
    // priorRawValues passed in, every section preserves the prior value.
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: { "active-days": { value: 17 }, "pr-rate": { value: 0.15 } },
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      priorRawValues: {
        "loop-uptime": "11% (27/238) fraction",
        "task-throughput": "28.9 tasks/day",
        "extraction-count": "1 count",
      },
    });
    const stubMatches = md.match(/\*\*Value:\*\* \(stub\)/g) ?? [];
    expect(stubMatches).toHaveLength(0);
    expect(md).toContain("Carry-forward: prior value retained");
  });

  test("partial overlap: snapshot has one aligned id; the rest carry forward", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: { "task-throughput": { value: 3.4 } },
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      priorRawValues: {
        "loop-uptime": "11% (27/238) fraction",
        // extraction-count has no prior either → stub falls through
      },
    });
    // Fresh: task-throughput
    expect(md).toContain("**Value:** 3.4 tasks/day");
    // Carry-forward: loop-uptime
    expect(md).toContain("**Value:** 11% (27/238) fraction");
    // Stub: extraction-count
    expect(md).toContain("## extraction-count");
    expect(md).toMatch(/extraction-count[\s\S]*?\(stub\) — no observation captured yet/);
  });

  test("priorRawValues containing `(stub)` are NOT carried forward (no stub-of-stub)", () => {
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      priorRawValues: {
        "loop-uptime": "(stub) — no observation captured yet (anything)",
      },
    });
    // Falls through to the regular stub render — no `Carry-forward:` header
    expect(md).not.toContain("Carry-forward:");
    expect(md).toContain("**Value:** (stub) — no observation captured yet");
  });

  test("end-to-end: prior METRICS.md document round-trips through extract → render unchanged values", () => {
    const priorDoc = [
      "# METRICS.md — canonical observability surface",
      "",
      "preamble",
      "",
      "## loop-uptime — Loop uptime",
      "",
      "_Updated: 2026-05-29T00:00:00Z · Budget: 7d_",
      "",
      "**Value:** 11% (27/238 validated iterations over 30d) fraction",
      "",
      "**How to view:** `cmd`",
      "",
    ].join("\n");
    const md = runMetricsRender({
      metrics: FIXTURE_METRICS,
      snapshot: undefined,
      snapshotTimestampMs: SNAPSHOT_TS,
      nowMs: NOW,
      priorRawValues: extractPriorRawValues(priorDoc),
    });
    expect(md).toContain("**Value:** 11% (27/238 validated iterations over 30d) fraction");
  });
});

describe("DEFAULT_OUTPUT_RELATIVE", () => {
  // The default-output path is the contract between three independent
  // surfaces: this CLI's writer, the daemon's mtime probe
  // (`novel/tick-loop/bin/tick-loop.mjs:1259`), and the milestone-
  // alignment gate (`scripts/check-milestone-alignment.mjs:605`). If
  // any of those drift, the daemon's daily render silently writes to
  // a file no one reads — the bug that left `docs/METRICS.md` stale
  // and every M1.X metric-tagged criterion stuck in `(stub)` state
  // pre-this-PR. Pinning the value here is the rule-#10 ratchet: any
  // future PR that changes the constant must update both other
  // surfaces in the same commit, or this test fails.
  test("is exactly 'docs/METRICS.md' (canonical location, read by alignment gate)", () => {
    expect(DEFAULT_OUTPUT_RELATIVE).toBe("docs/METRICS.md");
  });

  test("is a relative path (the CLI resolves against process.cwd() so the constant must not be absolute)", () => {
    expect(DEFAULT_OUTPUT_RELATIVE.startsWith("/")).toBe(false);
  });
});
