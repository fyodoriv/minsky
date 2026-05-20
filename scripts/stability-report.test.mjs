// Tests for `scripts/stability-report.mjs` — the multi-window CLI built
// on top of `scripts/lib/stability.mjs`. Plus a regression test asserting
// the legacy `stability-number.mjs` 7d number matches what
// `stability-report.mjs --window=7d` produces.
//
// Pattern: pure-output observation — the script runs in a hermetic
// tmpdir against synthetic fixtures, asserts the stdout. Same shape as
// `stability-number.test.mjs`.
// Source: docs/plans/fleet-stability-centralized-reporting.md § Step 1.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_SCRIPT = resolve(HERE, "stability-report.mjs");
const NUMBER_SCRIPT = resolve(HERE, "stability-number.mjs");

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [script]
 */
function run(args, cwd, script = REPORT_SCRIPT) {
  try {
    const stdout = execFileSync("node", [script, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = /** @type {{ stdout?: string; status?: number; stderr?: string }} */ (err);
    return { stdout: e.stdout ?? "", status: e.status ?? 1, stderr: e.stderr ?? "" };
  }
}

/**
 * Build a fixture host directory with the given iteration records
 * written to `.minsky/experiment-store/cross-repo/test.jsonl`.
 * @param {object[]} records
 */
function makeFixtureHost(records) {
  const dir = mkdtempSync(join(tmpdir(), "stability-report-"));
  const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
  mkdirSync(storeDir, { recursive: true });
  if (records.length > 0) {
    writeFileSync(
      join(storeDir, "test.jsonl"),
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }
  return dir;
}

const NOW = "2026-05-20T15:00:00Z";
const NOW_MS = new Date(NOW).getTime();
/** @param {number} hoursAgo */
const isoMinusHours = (hoursAgo) => new Date(NOW_MS - hoursAgo * 60 * 60 * 1000).toISOString();
/** @param {number} daysAgo */
const isoMinusDays = (daysAgo) => isoMinusHours(daysAgo * 24);

describe("stability-report.mjs — output shape", () => {
  test("default windows returns array with four elements in canonical order", () => {
    const host = makeFixtureHost([{ ts: isoMinusHours(1), verdict: "validated" }]);
    const { stdout, status } = run(["--json", "--host-dir", host, "--now", NOW], host);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);
    expect(parsed.map((/** @type {{window: string}} */ r) => r.window)).toEqual([
      "10h",
      "24h",
      "7d",
      "30d",
    ]);
  });

  test("single --window returns one-element array", () => {
    const host = makeFixtureHost([{ ts: isoMinusHours(1), verdict: "validated" }]);
    const { stdout } = run(["--window=7d", "--json", "--host-dir", host, "--now", NOW], host);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].window).toBe("7d");
  });

  test("multiple --window flags preserve CLI order", () => {
    const host = makeFixtureHost([{ ts: isoMinusHours(1), verdict: "validated" }]);
    const { stdout } = run(
      ["--window=30d", "--window=10h", "--window=7d", "--json", "--host-dir", host, "--now", NOW],
      host,
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.map((/** @type {{window: string}} */ r) => r.window)).toEqual([
      "30d",
      "10h",
      "7d",
    ]);
  });

  test("ratio is decimal 0.0–1.0, not percentage", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "spawn-failed" },
      { ts: isoMinusHours(1), verdict: "scope-leak" },
    ]);
    const { stdout } = run(["--window=7d", "--json", "--host-dir", host, "--now", NOW], host);
    const parsed = JSON.parse(stdout);
    // 2 validated of 4 total → 0.5 (not 50)
    expect(parsed[0].ratio).toBe(0.5);
    expect(parsed[0].successful).toBe(2);
    expect(parsed[0].total).toBe(4);
  });
});

describe("stability-report.mjs — edge cases", () => {
  test("empty experiment-store → all windows return ratio:null source:no-data", () => {
    const host = mkdtempSync(join(tmpdir(), "stability-report-empty-"));
    const { stdout, status } = run(["--json", "--host-dir", host, "--now", NOW], host);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveLength(4);
    for (const r of parsed) {
      expect(r.ratio).toBeNull();
      expect(r.source).toBe("no-data");
      expect(r.successful).toBe(0);
      expect(r.total).toBe(0);
    }
  });

  test("only-old records (older than 30d) → all windows null with no-recent-data", () => {
    const host = makeFixtureHost([
      { ts: isoMinusDays(45), verdict: "validated" },
      { ts: isoMinusDays(60), verdict: "validated" },
    ]);
    const { stdout } = run(["--json", "--host-dir", host, "--now", NOW], host);
    const parsed = JSON.parse(stdout);
    for (const r of parsed) {
      expect(r.ratio).toBeNull();
      expect(r.source).toBe("no-recent-data");
    }
  });

  test("records inside 10h appear in 10h/24h/7d/30d; records inside 7d only appear in 7d/30d", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(2), verdict: "validated" }, // in 10h
      { ts: isoMinusHours(20), verdict: "validated" }, // in 24h (not 10h)
      { ts: isoMinusDays(3), verdict: "validated" }, // in 7d (not 24h)
      { ts: isoMinusDays(20), verdict: "spawn-failed" }, // in 30d (not 7d)
    ]);
    const { stdout } = run(["--json", "--host-dir", host, "--now", NOW], host);
    const parsed = JSON.parse(stdout);
    const byWindow = Object.fromEntries(
      parsed.map((/** @type {{window: string}} */ r) => [r.window, r]),
    );
    expect(byWindow["10h"].total).toBe(1);
    expect(byWindow["24h"].total).toBe(2);
    expect(byWindow["7d"].total).toBe(3);
    expect(byWindow["30d"].total).toBe(4);
    expect(byWindow["30d"].successful).toBe(3); // 3 validated + 1 spawn-failed
  });

  test("human-readable mode without --json prints one line per window", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "spawn-failed" },
    ]);
    const { stdout, status } = run(["--host-dir", host, "--now", NOW], host);
    expect(status).toBe(0);
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(4); // four canonical windows
    expect(lines[0]).toMatch(/^10h\s*:\s*50%\s*\(1\/2 successful\)/);
  });
});

describe("stability-number.mjs ↔ stability-report.mjs regression", () => {
  test("stability-number 7d output matches stability-report --window=7d (round-trip)", () => {
    const host = makeFixtureHost([
      { ts: isoMinusDays(1), verdict: "validated" },
      { ts: isoMinusDays(1), verdict: "validated" },
      { ts: isoMinusDays(1), verdict: "validated" },
      { ts: isoMinusDays(2), verdict: "spawn-failed" },
      { ts: isoMinusDays(2), verdict: "spawn-failed" },
    ]);
    const numberOut = run([host, "--json"], host, NUMBER_SCRIPT);
    expect(numberOut.status).toBe(0);
    const numberParsed = JSON.parse(numberOut.stdout);

    const reportOut = run(["--host-dir", host, "--window=7d", "--json"], host);
    expect(reportOut.status).toBe(0);
    const reportParsed = JSON.parse(reportOut.stdout);

    // stability-number outputs an object with stability_pct (integer percentage).
    // stability-report outputs an array; .[0] is the 7d entry with ratio (decimal).
    // The round-trip: Math.round(ratio * 100) === stability_pct.
    expect(reportParsed[0].window).toBe("7d");
    if (numberParsed.stability_pct !== null) {
      expect(Math.round(reportParsed[0].ratio * 100)).toBe(numberParsed.stability_pct);
    }
    expect(reportParsed[0].successful).toBe(numberParsed.successful);
    expect(reportParsed[0].total).toBe(numberParsed.total);
  });
});
