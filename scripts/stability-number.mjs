#!/usr/bin/env node
// Compute a single stability number (0-100%) from experiment-store jsonl.
// Usage: node scripts/stability-number.mjs [host-dir] [--json]
// Output: "73% (22/30 successful, 7d)" or JSON.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const hostDir = process.argv[2] || process.cwd();
const jsonMode = process.argv.includes("--json");
const storeDir = resolve(hostDir, ".minsky", "experiment-store", "cross-repo");

if (!existsSync(storeDir)) {
  if (jsonMode) {
    console.log(JSON.stringify({ stability_pct: null, source: "no-data", successful: 0, total: 0 }));
  } else {
    console.log("Stability: no data yet (run minsky for ≥1 hour to measure)");
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
      if (ts >= sevenDaysAgo) {
        records.push(d);
      }
    } catch { /* skip */ }
  }
}

if (records.length === 0) {
  if (jsonMode) {
    console.log(JSON.stringify({ stability_pct: null, source: "no-recent-data", successful: 0, total: 0, window: "7d" }));
  } else {
    console.log("Stability: no data in last 7d (run minsky to generate data)");
  }
  process.exit(0);
}

const successful = records.filter((r) => r.verdict === "validated").length;
const total = records.length;
const pct = Math.round((successful / total) * 100);

if (jsonMode) {
  console.log(JSON.stringify({
    stability_pct: pct,
    successful,
    total,
    window: "7d",
    source: "experiment-store",
  }));
} else {
  console.log(`${pct}% (${successful}/${total} successful, 7d rolling)`);
}
