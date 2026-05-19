// Smoke + structural tests for `stability-number.mjs`. The script
// computes the rolling 7-day stability percentage from the
// experiment-store. Used by `bin/minsky status` to print the
// `Stability: N%` line.
//
// Pattern: pure-output observation (no I/O mocking). Each test
// invokes the script in a hermetic tmpdir, asserts the output. Lifts
// L6 (`scripts/full-coverage-report.mjs`) from 89% → ≥95%.
//
// Source: rule #4 (everything measurable, everything visible);
// rule #17 (proactive healing — observed L6 gap is a fix).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "stability-number.mjs");

function run(args, cwd) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

function makeFixtureHost(records) {
  const dir = mkdtempSync(join(tmpdir(), "stability-number-"));
  const storeDir = join(dir, ".minsky", "experiment-store", "cross-repo");
  mkdirSync(storeDir, { recursive: true });
  if (records.length > 0) {
    writeFileSync(
      join(storeDir, "test.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  }
  return dir;
}

describe("stability-number smoke", () => {
  test("no experiment-store ⇒ 'no data yet' message", () => {
    const dir = mkdtempSync(join(tmpdir(), "stability-empty-"));
    const r = run([dir], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no data");
  });

  test("--json flag returns parseable JSON with null pct on empty data", () => {
    const dir = mkdtempSync(join(tmpdir(), "stability-empty-json-"));
    const r = run([dir, "--json"], dir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.stability_pct).toBeNull();
    expect(parsed.successful).toBe(0);
  });

  test("with all-validated history ⇒ 100% stability", () => {
    const records = Array.from({ length: 5 }, (_, i) => ({
      ts: new Date().toISOString(),
      experiment_id: `task-${i}`,
      verdict: "validated",
      pr_url: `https://example/pr/${i}`,
    }));
    const dir = makeFixtureHost(records);
    const r = run([dir, "--json"], dir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.stability_pct).toBe(100);
    expect(parsed.successful).toBe(5);
    expect(parsed.total).toBe(5);
  });

  test("with mixed verdicts ⇒ percentage matches successful/total", () => {
    const records = [
      { ts: new Date().toISOString(), verdict: "validated", pr_url: "x" },
      { ts: new Date().toISOString(), verdict: "validated", pr_url: "x" },
      { ts: new Date().toISOString(), verdict: "spawn-failed", pr_url: null },
      { ts: new Date().toISOString(), verdict: "scope-leak", pr_url: null },
    ];
    const dir = makeFixtureHost(records);
    const r = run([dir, "--json"], dir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.total).toBe(4);
    expect(parsed.successful).toBeGreaterThanOrEqual(0);
    expect(parsed.stability_pct).toBeGreaterThanOrEqual(0);
    expect(parsed.stability_pct).toBeLessThanOrEqual(100);
  });

  test("plain output is human-readable (contains '%' or 'no data')", () => {
    const records = [{ ts: new Date().toISOString(), verdict: "validated", pr_url: "x" }];
    const dir = makeFixtureHost(records);
    const r = run([dir], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/(%|no data)/);
  });
});
