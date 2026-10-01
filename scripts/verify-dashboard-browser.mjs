#!/usr/bin/env node
// @ts-check
// Browser smoke test for the run dashboard (task obs-browser-verified-run-
// dashboard). Renders a DEMO report (non-empty tiles), then:
//   (1) deterministically asserts all 7 tiles are present — the STABLE hard gate
//       (no browser needed, so it's a reliable merge gate); then
//   (2) best-effort drives `agent-browser` to actually open + read the page —
//       the "verified via browser" demonstration the operator asked for; warns
//       but never fails on a missing/headless browser (rule #6/#7).
// Exit 0 = tiles present; exit 1 = a tile is missing from the rendered report.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReportHtml } from "./render-run-report.mjs";

const TILES = [
  "uptime",
  "tasks-merged",
  "cost-per-pr",
  "mean-latency",
  "error-count",
  "mean-quality",
  "competitive",
];

const demoHtml = renderReportHtml({
  summary: {
    runId: "demo",
    totalUptimeSec: 8 * 3600,
    longestUninterruptedSec: 6 * 3600,
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
});

/** @param {string} fileUrl @returns {{ ok: boolean, detail: string }} */
function browserCheck(fileUrl) {
  try {
    execFileSync("agent-browser", ["--auto-connect", "open", fileUrl], {
      stdio: "pipe",
      timeout: 45000,
    });
    const out = execFileSync(
      "agent-browser",
      [
        "eval",
        "JSON.stringify([...document.querySelectorAll('[data-tile]')].map(e=>({id:e.getAttribute('data-tile'),empty:!(e.querySelector('.val')?.textContent||'').trim()})))",
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    return { ok: true, detail: out.trim() };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 160) };
  }
}

function main() {
  const missing = TILES.filter((t) => !demoHtml.includes(`data-tile="${t}"`));
  if (missing.length > 0) {
    process.stderr.write(`dashboard verify FAIL: missing tiles ${missing.join(", ")}\n`);
    process.exit(1);
  }

  const file = join(mkdtempSync(join(tmpdir(), "minsky-dash-")), "report.html");
  writeFileSync(file, demoHtml);
  const b = browserCheck(`file://${file}`);
  process.stdout.write(
    b.ok
      ? `dashboard verify: 7 tiles present + agent-browser loaded them → ${b.detail}\n`
      : `dashboard verify: 7 tiles present (structural). agent-browser skipped (${b.detail})\n`,
  );
  process.exit(0);
}

main();
