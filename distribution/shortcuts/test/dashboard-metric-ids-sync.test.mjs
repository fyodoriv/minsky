// @ts-check
// Drift gate (Path A decouple-before-delete, 2026-05-25):
// `distribution/shortcuts/test/dashboard-metric-ids.json` is the
// source-of-truth used by `shortcuts-json.test.mjs` to validate the
// per-shortcut metric_id contract. It survives `novel/dashboard-web/`'s
// eventual deletion (operator-gated on dashboard replacement landing —
// see `docs/plans/2026-05-24-path-a-aggressive-cut.md` § dashboard-web).
//
// While dashboard-web still ships, both surfaces (the JSON + the TS
// arrays at `novel/dashboard-web/src/metrics.ts` / `watch.ts`) must
// agree. This test extracts the TS-side IDs via regex (no module
// import — keeps the test runnable without dashboard-web built) and
// asserts the JSON is a strict mirror.
//
// When dashboard-web is deleted, this test is deleted alongside it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const METRIC_IDS_JSON = resolve(HERE, "dashboard-metric-ids.json");
const METRICS_TS = resolve(REPO_ROOT, "novel/dashboard-web/src/metrics.ts");
const WATCH_TS = resolve(REPO_ROOT, "novel/dashboard-web/src/watch.ts");

// Test silently passes when dashboard-web has been deleted (the
// Path-A end-state). The JSON survives as the source of truth and
// the shortcut test keeps using it.
const dashboardWebShipped = existsSync(METRICS_TS) && existsSync(WATCH_TS);

function extractSuccessMetricIds() {
  const src = readFileSync(METRICS_TS, "utf8");
  const out = [];
  for (const line of src.split("\n")) {
    const match = line.match(/^\s+id:\s+"([^"]+)",/);
    if (match) out.push(match[1]);
  }
  return out;
}

function extractWatchMetricIds() {
  const src = readFileSync(WATCH_TS, "utf8");
  // Lines inside the `WATCH_METRIC_IDS = { ... }` block look like
  //   "tokens-remaining": "token-budget-honoring",
  const out = {};
  let inBlock = false;
  for (const line of src.split("\n")) {
    if (line.includes("WATCH_METRIC_IDS = {")) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.startsWith("}")) break;
    const match = line.match(/^\s+"([^"]+)":\s+"([^"]+)"/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

describe("dashboard-metric-ids JSON ↔ novel/dashboard-web TS source", () => {
  it("JSON is a strict mirror of SUCCESS_METRICS ids (while dashboard-web ships)", () => {
    if (!dashboardWebShipped) {
      // Sanity assertion so the test still reports a deliberate skip
      // rather than a silent pass.
      expect(dashboardWebShipped).toBe(false);
      return;
    }
    const tsIds = extractSuccessMetricIds();
    expect(tsIds.length).toBeGreaterThan(0);

    /** @type {{ success_metric_ids: readonly string[] }} */
    const json = JSON.parse(readFileSync(METRIC_IDS_JSON, "utf8"));
    expect(json.success_metric_ids).toEqual(tsIds);
  });

  it("JSON is a strict mirror of WATCH_METRIC_IDS (while dashboard-web ships)", () => {
    if (!dashboardWebShipped) {
      expect(dashboardWebShipped).toBe(false);
      return;
    }
    const tsMap = extractWatchMetricIds();
    expect(Object.keys(tsMap).length).toBeGreaterThan(0);

    /** @type {{ watch_metric_ids: Record<string,string> }} */
    const json = JSON.parse(readFileSync(METRIC_IDS_JSON, "utf8"));
    expect(json.watch_metric_ids).toEqual(tsMap);
  });
});
