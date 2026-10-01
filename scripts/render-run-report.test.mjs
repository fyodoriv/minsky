// @ts-check
// Tests for the run-report renderer (task obs-browser-verified-run-dashboard).
import { describe, expect, it } from "vitest";
import { renderReportHtml } from "./render-run-report.mjs";

const demo = {
  summary: {
    runId: "R1",
    totalUptimeSec: 8 * 3600,
    tasksMerged: 8,
    meanCostPerMergedPr: 1.25,
    meanMergeLatencySec: 3600,
    meanQuality: 0.9,
  },
  scorecard: {
    competitors: [
      {
        id: "devin",
        label: "Devin",
        deltas: [{ metricId: "cost-per-merged-pr", minsky: 1.25, competitor: 2, delta: 0.75 }],
      },
    ],
  },
  errorCount: 3,
};

const TILES = [
  "uptime",
  "tasks-merged",
  "cost-per-pr",
  "mean-latency",
  "error-count",
  "mean-quality",
  "competitive",
];

describe("renderReportHtml", () => {
  it("renders all 7 tiles", () => {
    const html = renderReportHtml(demo);
    for (const id of TILES) expect(html).toContain(`data-tile="${id}"`);
  });

  it("renders the metric values + competitor row", () => {
    const html = renderReportHtml(demo);
    expect(html).toContain("8.0h"); // uptime
    expect(html).toContain("$1.25"); // cost
    expect(html).toContain("Devin"); // competitor
    expect(html).toContain("0.9"); // quality
  });

  it("shows a dash for missing metrics (graceful, never blank)", () => {
    const html = renderReportHtml({ summary: { runId: "empty" }, scorecard: {}, errorCount: 0 });
    for (const id of TILES) expect(html).toContain(`data-tile="${id}"`);
    expect(html).toContain("—");
  });

  it("HTML-escapes untrusted values (rule #7)", () => {
    const html = renderReportHtml({ summary: { runId: "<script>alert(1)</script>" } });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
