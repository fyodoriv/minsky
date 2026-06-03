#!/usr/bin/env node
// @ts-check
// obs-browser-verified-run-dashboard: render ONE self-contained HTML report for
// a run — uptime, tasks merged, cost/task, mean latency, error count, mean
// quality, and the Minsky-vs-competitor table — from `run-summary.json`,
// `.minsky/competitive-scorecard.json`, and the run's `errors.jsonl`.
//
// A static file (openable as file://) rather than a live server: the task's
// Pivot — a stable artifact beats a flaky SSR (rule #6/#7). Every tile carries a
// `data-tile` attribute + a `.val` node so the browser smoke test
// (`verify-dashboard-browser.mjs`) can assert it. Values are HTML-escaped.
//
// Anchor: Card, Mackinlay, Shneiderman, "Readings in Information Visualization",
// 1999 — glanceable, overview-first display.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const RUNS = join(REPO, ".minsky", "runs");

/** @param {unknown} v @returns {string} */
const esc = (v) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** @param {number | null | undefined} sec */
const dur = (sec) => (typeof sec === "number" ? `${(sec / 3600).toFixed(1)}h` : "—");

/**
 * The 7 tiles (6 metric tiles + the competitive table) as id/label/value rows.
 * @param {any} summary @param {number} errorCount
 */
function metricTiles(summary, errorCount) {
  return [
    { id: "uptime", label: "Uptime", val: dur(summary.totalUptimeSec) },
    { id: "tasks-merged", label: "Tasks merged", val: esc(summary.tasksMerged ?? 0) },
    {
      id: "cost-per-pr",
      label: "Mean cost / PR",
      val: summary.meanCostPerMergedPr == null ? "—" : `$${esc(summary.meanCostPerMergedPr)}`,
    },
    { id: "mean-latency", label: "Mean latency / PR", val: dur(summary.meanMergeLatencySec) },
    { id: "error-count", label: "Errors", val: esc(errorCount) },
    { id: "mean-quality", label: "Mean quality", val: esc(summary.meanQuality) },
  ];
}

/** @param {any} scorecard */
function competitiveTable(scorecard) {
  /** @type {any[]} */
  const comps = Array.isArray(scorecard?.competitors) ? scorecard.competitors : [];
  const rows = comps
    .map((/** @type {any} */ c) => {
      const cells = /** @type {any[]} */ (c.deltas ?? [])
        .map(
          (/** @type {any} */ d) =>
            `<tr><td>${esc(d.metricId)}</td><td>${esc(d.minsky)}</td><td>${esc(d.competitor)}</td><td>${esc(d.delta)}</td></tr>`,
        )
        .join("");
      return `<details><summary>${esc(c.label)}</summary><table><thead><tr><th>metric</th><th>minsky</th><th>them</th><th>Δ</th></tr></thead><tbody>${cells}</tbody></table></details>`;
    })
    .join("");
  return `<section class="tile" data-tile="competitive"><h2>Minsky vs competitors</h2><div class="val">${comps.length ? rows : "—"}</div></section>`;
}

/**
 * Pure: render the full report HTML.
 * @param {{ summary?: any, scorecard?: any, errorCount?: number }} input
 * @returns {string}
 */
export function renderReportHtml({ summary = {}, scorecard = {}, errorCount = 0 } = {}) {
  const tiles = metricTiles(summary, errorCount)
    .map(
      (t) =>
        `<section class="tile" data-tile="${t.id}"><h2>${esc(t.label)}</h2><div class="val">${t.val}</div></section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Minsky run ${esc(summary.runId)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 1.2rem; } h2 { font-size: .8rem; text-transform: uppercase; color: #8a93a3; margin: 0 0 .3rem; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .tile { background: #1a1e26; border: 1px solid #2a2f3a; border-radius: 10px; padding: 1rem; }
  .val { font-size: 1.6rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; } td, th { text-align: left; padding: 2px 6px; }
  details { margin: .3rem 0; }
</style></head>
<body>
  <h1>Minsky run — <code>${esc(summary.runId)}</code></h1>
  <div class="grid">
${tiles}
${competitiveTable(scorecard)}
  </div>
</body></html>
`;
}

/** @returns {string | null} */
function latestRunDir() {
  if (!existsSync(RUNS)) return null;
  const dirs = readdirSync(RUNS)
    .map((n) => ({ n, p: join(RUNS, n) }))
    .filter((e) => {
      try {
        return statSync(e.p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b.p).mtimeMs - statSync(a.p).mtimeMs);
  const top = dirs[0];
  return top ? top.n : null;
}

/** @param {string} p @returns {any} */
function readJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} runId @returns {number} */
function errorCountFor(runId) {
  const f = join(RUNS, runId, "errors.jsonl");
  if (!existsSync(f)) return 0;
  return readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim()).length;
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--run");
  const arg = i >= 0 ? args[i + 1] : "latest";
  const runId = !arg || arg === "latest" ? latestRunDir() : arg;

  const summary = runId ? (readJson(join(RUNS, runId, "run-summary.json")) ?? {}) : {};
  const scorecard = readJson(join(REPO, ".minsky", "competitive-scorecard.json")) ?? {};
  const html = renderReportHtml({
    summary,
    scorecard,
    errorCount: runId ? errorCountFor(runId) : 0,
  });

  if (runId) {
    const out = join(RUNS, runId, "report.html");
    try {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, html);
      process.stdout.write(`${out}\n`);
      return;
    } catch {
      /* fall through to stdout */
    }
  }
  process.stdout.write(html);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
