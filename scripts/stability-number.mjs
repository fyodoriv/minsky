#!/usr/bin/env node
// Compute a single stability number (0-100%) from experiment-store jsonl.
// Usage: node scripts/stability-number.mjs [host-dir] [--json]
// Output: "73% (22/30 successful, 7d)" or JSON.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isTaskAttempt } from "./lib/stability.mjs";

// First non-flag positional arg is the host dir; flags (e.g. `--json`)
// must NOT be consumed as the host dir. The bare `argv[2]` read meant
// `stability-number.mjs --json` resolved host-dir="--json" → no-data
// (the documented Measurement command for the 8h proof was broken).
const hostDir = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? process.cwd();
const jsonMode = process.argv.includes("--json");
const storeDir = resolve(hostDir, ".minsky", "experiment-store", "cross-repo");

if (!existsSync(storeDir)) {
  if (jsonMode) {
    console.info(
      JSON.stringify({ stability_pct: null, source: "no-data", successful: 0, total: 0 }),
    );
  } else {
    console.info("Stability: no data yet (run minsky for ≥1 hour to measure)");
  }
  process.exit(0);
}

// Parse all jsonl records
const records = [];
const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

for (const file of readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"))) {
  const content = readFileSync(join(storeDir, file), "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      const ts = new Date(d.ts).getTime();
      // Exclude drained-queue bookkeeping ticks (and the legacy
      // aborted+"no eligible task" shape) from the SLI — same valid-event
      // qualification the stability-report lib applies. Without this the
      // single stability number is poisoned by idle polls, exactly the
      // bug `drained-queue-not-an-iteration` fixed in stability-report.
      if (ts >= sevenDaysAgo && isTaskAttempt(d)) {
        records.push(d);
      }
    } catch {
      /* skip */
    }
  }
}

if (records.length === 0) {
  if (jsonMode) {
    console.info(
      JSON.stringify({
        stability_pct: null,
        source: "no-recent-data",
        successful: 0,
        total: 0,
        window: "7d",
      }),
    );
  } else {
    console.info("Stability: no data in last 7d (run minsky to generate data)");
  }
  process.exit(0);
}

const successful = records.filter((r) => r.verdict === "validated").length;
const total = records.length;
const pct = Math.round((successful / total) * 100);

if (jsonMode) {
  console.info(
    JSON.stringify({
      stability_pct: pct,
      successful,
      total,
      window: "7d",
      source: "experiment-store",
    }),
  );
} else {
  console.info(`${pct}% (${successful}/${total} successful, 7d rolling)`);
}
