#!/usr/bin/env node
// Compute a single stability number (0–100%) for the rolling 7-day
// window. Thin wrapper around `scripts/lib/stability.mjs`.
//
// Usage: node scripts/stability-number.mjs [host-dir] [--json]
// Output: "73% (22/30 successful, 7d)" OR
//         {stability_pct: 73, successful: 22, total: 30, window: "7d", source: "experiment-store"}
//
// The output shape is preserved from the pre-refactor implementation so
// `bin/minsky status` and the test fixtures continue to work without
// modification. The refactor delegates the read+compute logic to the
// shared helper (rule #1 — don't duplicate the experiment-store reader
// or the window-ratio math).
//
// Pattern: SLI/SLO measurement (single-window scalar form) — Beyer
//   et al. 2016, *SRE*, Ch. 4.
// Source: docs/plans/fleet-stability-centralized-reporting.md § Step 1c.

import { computeHostStability } from "./lib/stability.mjs";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("--"));
const hostDir = positional[0] || process.cwd();

const results = computeHostStability({ hostDir, windowLabels: ["7d"], now: Date.now() });
const result = results[0];
if (!result) {
  // computeHostStability always returns one entry per requested window;
  // this guard is defensive (helps TypeScript narrow the array element).
  throw new Error(
    "stability-number: computeHostStability returned empty array (should be unreachable)",
  );
}

if (result.ratio === null) {
  if (jsonMode) {
    console.log(
      JSON.stringify({
        stability_pct: null,
        source: result.source,
        successful: 0,
        total: 0,
        window: "7d",
      }),
    );
  } else {
    if (result.source === "no-data") {
      console.log("Stability: no data yet (run minsky for ≥1 hour to measure)");
    } else {
      console.log("Stability: no data in last 7d (run minsky to generate data)");
    }
  }
  process.exit(0);
}

const pct = Math.round(result.ratio * 100);

if (jsonMode) {
  console.log(
    JSON.stringify({
      stability_pct: pct,
      successful: result.successful,
      total: result.total,
      window: "7d",
      source: "experiment-store",
    }),
  );
} else {
  console.log(`${pct}% (${result.successful}/${result.total} successful, 7d rolling)`);
}
