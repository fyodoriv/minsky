// Tests for `scripts/fleet-stability-report.mjs` — fleet-wide
// stability aggregation across multiple host directories.
//
// Pattern: pure-output observation — script runs in a hermetic tmpdir
// against synthetic per-host fixtures, asserts the aggregated stdout.
// Source: docs/plans/fleet-stability-centralized-reporting.md § Step 2.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "fleet-stability-report.mjs");

/**
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function run(args, env = {}) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, ...env },
    });
    return { stdout, status: 0, stderr: "" };
  } catch (err) {
    const e = /** @type {{ stdout?: string; status?: number; stderr?: string }} */ (err);
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? 1,
    };
  }
}

/**
 * @param {object[]} records
 * @returns {string} host directory
 */
function makeFixtureHost(records) {
  const dir = mkdtempSync(join(tmpdir(), "fleet-stability-"));
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

/**
 * Build a host with `successful` validated + `failed` spawn-failed records,
 * all 1h ago so they fall inside every window.
 * @param {number} successful
 * @param {number} failed
 */
function hostWithRatio(successful, failed) {
  /** @type {object[]} */
  const records = [];
  for (let i = 0; i < successful; i++) {
    records.push({ ts: isoMinusHours(1), verdict: "validated" });
  }
  for (let i = 0; i < failed; i++) {
    records.push({ ts: isoMinusHours(1), verdict: "spawn-failed" });
  }
  return makeFixtureHost(records);
}

describe("fleet-stability-report.mjs — aggregation arithmetic", () => {
  test("three-host fixture (A=10/10, B=5/10, C=0/10) → fleet 15/30 = 0.5", () => {
    const a = hostWithRatio(10, 0);
    const b = hostWithRatio(5, 5);
    const c = hostWithRatio(0, 10);
    const { stdout, status } = run([
      "--host",
      a,
      "--host",
      b,
      "--host",
      c,
      "--window=7d",
      "--json",
      "--now",
      NOW,
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.fleet.host_count).toBe(3);
    const summary = parsed.fleet.window_summary[0];
    expect(summary.window).toBe("7d");
    expect(summary.successful_sum).toBe(15);
    expect(summary.total_sum).toBe(30);
    expect(summary.ratio).toBe(0.5);
  });

  test("weighted average (A=10/10, B=5/100) → fleet 15/110 = 0.136 (not naive mean 0.525)", () => {
    const a = hostWithRatio(10, 0); // 100%
    const b = hostWithRatio(5, 95); // 5%
    const { stdout } = run(["--host", a, "--host", b, "--window=7d", "--json", "--now", NOW]);
    const parsed = JSON.parse(stdout);
    const summary = parsed.fleet.window_summary[0];
    expect(summary.successful_sum).toBe(15);
    expect(summary.total_sum).toBe(110);
    // 15/110 = 0.13636... — NOT the naive mean (1.00 + 0.05) / 2 = 0.525.
    expect(summary.ratio).toBeCloseTo(0.136, 3);
  });

  test("single-host invocation matches per-host stability-report numbers", () => {
    const host = hostWithRatio(7, 3);
    const { stdout } = run(["--host", host, "--window=7d", "--json", "--now", NOW]);
    const parsed = JSON.parse(stdout);
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.hosts[0].windows[0].successful).toBe(7);
    expect(parsed.hosts[0].windows[0].total).toBe(10);
    expect(parsed.hosts[0].windows[0].ratio).toBe(0.7);
    expect(parsed.fleet.window_summary[0].ratio).toBe(0.7);
  });
});

describe("fleet-stability-report.mjs — error handling", () => {
  test("missing host emits error entry, excluded from aggregate, valid host still counted", () => {
    const valid = hostWithRatio(8, 2);
    const { stdout, status } = run([
      "--host",
      "/nonexistent/path-that-does-not-exist",
      "--host",
      valid,
      "--window=7d",
      "--json",
      "--now",
      NOW,
    ]);
    expect(status).toBe(0); // at least one valid host → exit 0
    const parsed = JSON.parse(stdout);
    expect(parsed.hosts).toHaveLength(2);
    const missing = parsed.hosts.find(
      (/** @type {{host: string, error?: string}} */ h) =>
        h.host === "/nonexistent/path-that-does-not-exist",
    );
    expect(missing).toBeDefined();
    expect(missing.error).toBe("host-not-found");
    expect(missing.windows).toBeUndefined();
    expect(parsed.fleet.host_count).toBe(1); // only the valid host counted
    expect(parsed.fleet.window_summary[0].successful_sum).toBe(8);
    expect(parsed.fleet.window_summary[0].total_sum).toBe(10);
  });

  test("all hosts missing → exit code 1", () => {
    const { status } = run([
      "--host",
      "/nonexistent/a",
      "--host",
      "/nonexistent/b",
      "--window=7d",
      "--json",
      "--now",
      NOW,
    ]);
    expect(status).toBe(1);
  });

  test("no hosts specified → exit 1 with error", () => {
    const { status } = run(["--json", "--now", NOW]);
    expect(status).toBe(1);
  });
});

describe("fleet-stability-report.mjs — env-var fallback", () => {
  test("MINSKY_FLEET_HOSTS env var supplies hosts when --host not used", () => {
    const a = hostWithRatio(10, 0);
    const b = hostWithRatio(0, 10);
    const { stdout, status } = run(["--window=7d", "--json", "--now", NOW], {
      MINSKY_FLEET_HOSTS: `${a}:${b}`,
    });
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hosts).toHaveLength(2);
    expect(parsed.fleet.host_count).toBe(2);
    expect(parsed.fleet.window_summary[0].successful_sum).toBe(10);
    expect(parsed.fleet.window_summary[0].total_sum).toBe(20);
    expect(parsed.fleet.window_summary[0].ratio).toBe(0.5);
  });

  test("explicit --host overrides MINSKY_FLEET_HOSTS env (CLI wins)", () => {
    const cliHost = hostWithRatio(5, 5);
    const envHost = hostWithRatio(10, 0);
    const { stdout } = run(["--host", cliHost, "--window=7d", "--json", "--now", NOW], {
      MINSKY_FLEET_HOSTS: envHost,
    });
    const parsed = JSON.parse(stdout);
    // Only CLI host should appear (the env var is fallback only).
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.hosts[0].host).toBe(cliHost);
  });
});

describe("fleet-stability-report.mjs — multi-window output shape", () => {
  test("default windows produce four-row window_summary in canonical order", () => {
    const host = hostWithRatio(5, 5);
    const { stdout } = run(["--host", host, "--json", "--now", NOW]);
    const parsed = JSON.parse(stdout);
    expect(parsed.fleet.window_summary).toHaveLength(4);
    expect(
      parsed.fleet.window_summary.map((/** @type {{window: string}} */ w) => w.window),
    ).toEqual(["10h", "24h", "7d", "30d"]);
  });

  test("explicit window order preserved", () => {
    const host = hostWithRatio(5, 5);
    const { stdout } = run([
      "--host",
      host,
      "--window=30d",
      "--window=10h",
      "--json",
      "--now",
      NOW,
    ]);
    const parsed = JSON.parse(stdout);
    expect(
      parsed.fleet.window_summary.map((/** @type {{window: string}} */ w) => w.window),
    ).toEqual(["30d", "10h"]);
  });
});
