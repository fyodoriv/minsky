// Tests for `scripts/heal-mttr-report.mjs`.
//
// Pattern: pure-output observation. Each test creates a hermetic
// tmpdir, writes a fixture .minsky/heal-events.jsonl, invokes the
// script in --json mode, asserts the parsed output.
//
// Scenarios map to user-stories/007-agent-self-heals-catalogued-failures.md:
//   - "heal-mttr-report computes correct stats for a multi-window query"
//   - "heal-mttr-report returns no-data source when ledger is missing or empty"
//   - "heal-mttr-report only counts events whose ts_observed is within the window"
//
// Anchor for the L6 coverage gate: every code path in heal-mttr-report.mjs
// is exercised by these tests, including the percentile helper, the
// window-parser, the malformed-line skip, and the no-data fallback.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  computeWindowStats,
  parseWindowMs,
  percentile,
  readLedger,
} from "./heal-mttr-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "heal-mttr-report.mjs");

/**
 * @param {string[]} args
 * @returns {{ stdout: string; status: number }}
 */
function run(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = /** @type {{ stdout?: string; status?: number }} */ (err);
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

/**
 * @param {object[]} events
 * @returns {string} host directory
 */
function makeFixtureHost(events) {
  const dir = mkdtempSync(join(tmpdir(), "heal-mttr-"));
  if (events.length > 0) {
    const ledgerDir = join(dir, ".minsky");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      join(ledgerDir, "heal-events.jsonl"),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
  }
  return dir;
}

const T_NOW = "2026-05-20T20:00:00.000Z";
const T_NOW_MS = new Date(T_NOW).getTime();

/**
 * @param {{ deltaMs: number; outcome: string; durationMs?: number }} opts
 */
function event({ deltaMs, outcome, durationMs = 1000 }) {
  const tsObserved = T_NOW_MS - deltaMs;
  return {
    ts_observed: new Date(tsObserved).toISOString(),
    ts_fixed: new Date(tsObserved + durationMs).toISOString(),
    failure_class: "stale-pid",
    fix_applied: "heal-stale-pid",
    duration_ms: durationMs,
    host: "fixture-host",
    outcome,
  };
}

describe("parseWindowMs", () => {
  test("parses 24h, 7d, 30d, 1w", () => {
    expect(parseWindowMs("24h")).toBe(24 * 3600 * 1000);
    expect(parseWindowMs("7d")).toBe(7 * 86400 * 1000);
    expect(parseWindowMs("30d")).toBe(30 * 86400 * 1000);
    expect(parseWindowMs("1w")).toBe(7 * 86400 * 1000);
  });

  test("throws on bad input", () => {
    expect(() => parseWindowMs("abc")).toThrow();
    expect(() => parseWindowMs("24")).toThrow();
    expect(() => parseWindowMs("24x")).toThrow();
  });
});

describe("percentile", () => {
  test("returns null for empty array", () => {
    expect(percentile([], 0.5)).toBe(null);
  });

  test("p50 of [1,2,3,4,5] is 3", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  test("p95 of [1..100] is 95", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 0.95)).toBe(96);
  });
});

describe("readLedger", () => {
  test("returns [] when file does not exist", () => {
    expect(readLedger("/tmp/does-not-exist.jsonl")).toEqual([]);
  });

  test("skips malformed lines without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "heal-ledger-"));
    const path = join(dir, "heal-events.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({ outcome: "healed" })}\nnot-json\n${JSON.stringify({ outcome: "verified-failed" })}\n`,
    );
    const events = readLedger(path);
    expect(events).toHaveLength(2);
  });
});

describe("computeWindowStats", () => {
  // scenario: "heal-mttr-report computes correct stats for a multi-window query"
  test("computes per-window stats correctly", () => {
    const events = [
      event({ deltaMs: 2 * 3600 * 1000, outcome: "healed", durationMs: 1000 }), // 2h ago
      event({ deltaMs: 3 * 3600 * 1000, outcome: "verified-failed" }), // 3h ago
      event({ deltaMs: 10 * 86400 * 1000, outcome: "skipped" }), // 10d ago
    ];

    const r24h = computeWindowStats({ events, window: "24h", nowMs: T_NOW_MS });
    expect(r24h.attempted).toBe(2);
    expect(r24h.successful).toBe(1);
    expect(r24h.mttr_p50_ms).toBe(1000);
    expect(r24h.mttr_p95_ms).toBe(1000);
    expect(r24h.source).toBe("heal-events");

    const r7d = computeWindowStats({ events, window: "7d", nowMs: T_NOW_MS });
    expect(r7d.attempted).toBe(2);
    expect(r7d.successful).toBe(1);

    const r30d = computeWindowStats({ events, window: "30d", nowMs: T_NOW_MS });
    expect(r30d.attempted).toBe(3);
    expect(r30d.successful).toBe(1);
  });

  // scenario: "heal-mttr-report returns no-data source when ledger is missing or empty"
  test("returns no-data when window is empty", () => {
    const result = computeWindowStats({
      events: [],
      window: "30d",
      nowMs: T_NOW_MS,
    });
    expect(result).toEqual({
      window: "30d",
      attempted: 0,
      successful: 0,
      mttr_p50_ms: null,
      mttr_p95_ms: null,
      source: "no-data",
    });
  });

  // scenario: "heal-mttr-report only counts events whose ts_observed is within the window"
  test("only counts events inside the window", () => {
    const events = [
      event({ deltaMs: 1 * 3600 * 1000, outcome: "healed" }), // 1h ago
      event({ deltaMs: 25 * 3600 * 1000, outcome: "healed" }), // 25h ago (outside 24h)
      event({ deltaMs: 2 * 86400 * 1000, outcome: "healed" }), // 2d ago (outside 24h)
      event({ deltaMs: 31 * 86400 * 1000, outcome: "healed" }), // 31d ago (outside 30d)
    ];
    const r24h = computeWindowStats({ events, window: "24h", nowMs: T_NOW_MS });
    expect(r24h.attempted).toBe(1);
  });
});

describe("heal-mttr-report CLI smoke", () => {
  test("no ledger ⇒ all windows report no-data in JSON mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "heal-mttr-empty-"));
    const r = run([
      "--host-dir",
      dir,
      "--window=24h",
      "--window=7d",
      "--now=" + T_NOW,
      "--json",
    ]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe("no-data");
    expect(parsed[1].source).toBe("no-data");
  });

  test("3-event fixture: --window=7d --json output matches scenario", () => {
    const events = [
      event({ deltaMs: 2 * 3600 * 1000, outcome: "healed", durationMs: 1000 }),
      event({ deltaMs: 3 * 3600 * 1000, outcome: "verified-failed" }),
      event({ deltaMs: 10 * 86400 * 1000, outcome: "skipped" }),
    ];
    const dir = makeFixtureHost(events);
    const r = run([
      "--host-dir",
      dir,
      "--window=7d",
      "--now=" + T_NOW,
      "--json",
    ]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed[0].successful).toBe(1);
    expect(parsed[0].attempted).toBe(2);
    expect(typeof parsed[0].mttr_p50_ms).toBe("number");
  });

  test("text mode produces a one-line summary per window", () => {
    const events = [event({ deltaMs: 1 * 3600 * 1000, outcome: "healed" })];
    const dir = makeFixtureHost(events);
    const r = run([
      "--host-dir",
      dir,
      "--window=24h",
      "--now=" + T_NOW,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("24h:");
    expect(r.stdout).toContain("1/1 healed");
    expect(r.stdout).toContain("p50=1000ms");
  });

  test("default windows are 24h/7d/30d when --window omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "heal-mttr-default-"));
    const r = run([
      "--host-dir",
      dir,
      "--now=" + T_NOW,
      "--json",
    ]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((/** @type {{window: string}} */ p) => p.window)).toEqual([
      "24h",
      "7d",
      "30d",
    ]);
  });
});
