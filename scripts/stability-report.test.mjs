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

/**
 * Build a fixture host directory with the given iteration records
 * written to `.minsky/session-ledger.jsonl` (primary source).
 * @param {object[]} records
 */
function makeFixtureHostWithLedger(records) {
  const dir = mkdtempSync(join(tmpdir(), "stability-ledger-"));
  mkdirSync(join(dir, ".minsky"), { recursive: true });
  if (records.length > 0) {
    writeFileSync(
      join(dir, ".minsky", "session-ledger.jsonl"),
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

describe("valid-event qualification — drained records are not iterations", () => {
  // Regression pin for drained-queue-not-an-iteration: ~6000 idle-tick
  // records over 2 days drove 24h stability to 0% while the true
  // task-attempt ratio was non-zero (Beyer et al. 2016, *SRE*, Ch. 4 —
  // an SLI defines which events are valid before computing the ratio).

  test("verdict=drained records are excluded from numerator and denominator", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "spawn-failed" },
      { ts: isoMinusHours(1), verdict: "drained", notes: "no eligible task" },
      { ts: isoMinusHours(1), verdict: "drained", notes: "no eligible task" },
      { ts: isoMinusHours(1), verdict: "drained", notes: "no eligible task" },
    ]);
    const { stdout } = run(["--window=10h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(2);
    expect(w.successful).toBe(1);
    expect(w.ratio).toBe(0.5);
  });

  test("legacy aborted + 'no eligible task' records are excluded too", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "aborted", notes: "no eligible task" },
      { ts: isoMinusHours(1), verdict: "aborted", notes: "no eligible task" },
    ]);
    const { stdout } = run(["--window=10h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(1);
    expect(w.successful).toBe(1);
    expect(w.ratio).toBe(1);
  });

  test("aborted records with other notes still count as failed iterations", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(1), verdict: "aborted", notes: "invariant failed: git tree dirty" },
    ]);
    const { stdout } = run(["--window=10h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(2);
    expect(w.successful).toBe(1);
    expect(w.ratio).toBe(0.5);
  });

  test("window with only drained records reports no-recent-data, not 0%", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "drained", notes: "no eligible task" },
      { ts: isoMinusDays(20), verdict: "validated" },
    ]);
    const { stdout } = run(["--window=10h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(0);
    expect(w.ratio).toBeNull();
    expect(w.source).toBe("no-recent-data");
  });
});

describe("session-ledger primary source (PR #1250 wire-in)", () => {
  // Regression test for M1.1: session-ledger is now the primary data source.
  // 10 entries: 7 success (validated/merged/shipped) + 3 spawn-failed → ratio=0.7.

  test("10 entries (7 success, 3 spawn-failed) → ratio=0.7, source=session-ledger", () => {
    const host = makeFixtureHostWithLedger([
      {
        session_id: "t1",
        ts: isoMinusHours(1),
        task_id: "t1",
        verdict: "validated",
        files_changed: 2,
        loc_delta: 30,
      },
      {
        session_id: "t2",
        ts: isoMinusHours(2),
        task_id: "t2",
        verdict: "merged",
        files_changed: 1,
        loc_delta: 10,
      },
      {
        session_id: "t3",
        ts: isoMinusHours(3),
        task_id: "t3",
        verdict: "shipped",
        files_changed: 3,
        loc_delta: 50,
      },
      {
        session_id: "t4",
        ts: isoMinusHours(4),
        task_id: "t4",
        verdict: "validated",
        files_changed: 1,
        loc_delta: 5,
      },
      {
        session_id: "t5",
        ts: isoMinusHours(5),
        task_id: "t5",
        verdict: "validated",
        files_changed: 2,
        loc_delta: 15,
      },
      {
        session_id: "t6",
        ts: isoMinusHours(6),
        task_id: "t6",
        verdict: "validated",
        files_changed: 1,
        loc_delta: 8,
      },
      {
        session_id: "t7",
        ts: isoMinusHours(7),
        task_id: "t7",
        verdict: "validated",
        files_changed: 4,
        loc_delta: 60,
      },
      {
        session_id: "t8",
        ts: isoMinusHours(8),
        task_id: "t8",
        verdict: "spawn-failed",
        files_changed: 0,
        loc_delta: 0,
      },
      {
        session_id: "t9",
        ts: isoMinusHours(9),
        task_id: "t9",
        verdict: "spawn-failed",
        files_changed: 0,
        loc_delta: 0,
      },
      {
        session_id: "t10",
        ts: isoMinusHours(9),
        task_id: "t10",
        verdict: "spawn-failed",
        files_changed: 0,
        loc_delta: 0,
      },
    ]);
    const { stdout, status } = run(
      ["--window=24h", "--json", "--host-dir", host, "--now", NOW],
      host,
    );
    expect(status).toBe(0);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(10);
    expect(w.successful).toBe(7);
    expect(w.ratio).toBe(0.7);
    expect(w.source).toBe("session-ledger");
  });

  test("session-ledger takes priority over experiment-store when both exist", () => {
    const host = makeFixtureHostWithLedger([
      {
        session_id: "s1",
        ts: isoMinusHours(1),
        task_id: "s1",
        verdict: "validated",
        files_changed: 1,
        loc_delta: 10,
      },
    ]);
    // Also write an experiment-store entry — should be ignored since ledger has data.
    mkdirSync(join(host, ".minsky", "experiment-store", "cross-repo"), { recursive: true });
    writeFileSync(
      join(host, ".minsky", "experiment-store", "cross-repo", "old.jsonl"),
      `${JSON.stringify({ ts: isoMinusHours(2), verdict: "spawn-failed" })}\n`,
    );
    const { stdout } = run(["--window=24h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.source).toBe("session-ledger");
    expect(w.total).toBe(1);
    expect(w.successful).toBe(1);
  });

  test("falls back to experiment-store when session-ledger is absent", () => {
    const host = makeFixtureHost([
      { ts: isoMinusHours(1), verdict: "validated" },
      { ts: isoMinusHours(2), verdict: "spawn-failed" },
    ]);
    const { stdout } = run(["--window=24h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.source).toBe("experiment-store");
    expect(w.total).toBe(2);
    expect(w.successful).toBe(1);
  });

  test("drained entries in session-ledger are excluded from total and successful", () => {
    const host = makeFixtureHostWithLedger([
      {
        session_id: "s1",
        ts: isoMinusHours(1),
        task_id: "s1",
        verdict: "validated",
        files_changed: 1,
        loc_delta: 5,
      },
      {
        session_id: "s2",
        ts: isoMinusHours(1),
        task_id: "s2",
        verdict: "drained",
        files_changed: 0,
        loc_delta: 0,
      },
      {
        session_id: "s3",
        ts: isoMinusHours(1),
        task_id: "s3",
        verdict: "drained",
        files_changed: 0,
        loc_delta: 0,
      },
    ]);
    const { stdout } = run(["--window=24h", "--json", "--host-dir", host, "--now", NOW], host);
    const [w] = JSON.parse(stdout);
    expect(w.total).toBe(1);
    expect(w.successful).toBe(1);
    expect(w.ratio).toBe(1);
    expect(w.source).toBe("session-ledger");
  });
});
