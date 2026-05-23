// Tests for scripts/measure-agent-install.mjs — the harness that
// closes parent P0 `agent-mediated-install`'s Success #1 criterion.
//
// Hypothesis (rule #9): the harness is pure modulo (Date.now,
// readingFn), so the pure `buildReport()` function can be exercised
// fully with deterministic inputs. Mock-mode is the CI gate; live mode
// is deliberately stubbed (skipped readings) until a separate P2 task
// wires real-agent invocation.
//
// Success: ≥10 test cases covering args parsing, threshold semantics,
// aggregate verdict logic, mock-vs-live dispatch, JSON shape.
// Pivot: if a future change adds real-agent invocation, the test list
// grows but the existing tests must stay passing (mock determinism is
// a load-bearing CI invariant).
// Measurement: this test file.
// Anchor: rule #9 (pre-registered metrics); rule #11 (no flaky
// metrics — mock determinism is the anti-flake guarantee).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { buildReport, mockReading } from "./measure-agent-install.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = resolve(HERE, "measure-agent-install.mjs");

describe("measure-agent-install.mjs — buildReport (pure function)", () => {
  test("mock provider with 3 runs and default thresholds: all pass, aggregate=pass", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.runs).toHaveLength(3);
    expect(r.totals.passed).toBe(3);
    expect(r.totals.failed).toBe(0);
    expect(r.totals.skipped).toBe(0);
    expect(r.aggregate_verdict).toBe("pass");
    expect(r.runs_passed).toBe(3);
  });

  test("mock provider with threshold-seconds=1 (impossible): all fail, aggregate=fail", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 1,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.failed).toBe(3);
    expect(r.totals.passed).toBe(0);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs_passed).toBe(0);
  });

  test("mock provider with threshold-prompts=0: all fail (mock asks 1 prompt)", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 0,
      live: false,
    });
    expect(r.totals.failed).toBe(3);
    expect(r.aggregate_verdict).toBe("fail");
  });

  test("real provider without --live: emits skipped readings with a reason", () => {
    const r = buildReport({
      providers: ["claude-code"],
      runsPerProvider: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.skipped).toBe(2);
    expect(r.totals.passed).toBe(0);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs[0]?.reason).toMatch(/requires --live/);
  });

  test("real provider WITH --live: emits skipped readings (v1 stub) with not-implemented reason", () => {
    const r = buildReport({
      providers: ["claude-code"],
      runsPerProvider: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: true,
    });
    expect(r.totals.skipped).toBe(2);
    expect(r.aggregate_verdict).toBe("fail");
    expect(r.runs[0]?.reason).toMatch(/live mode not implemented/);
  });

  test("mock + real (no --live): mock passes, real skips → aggregate fails", () => {
    const r = buildReport({
      providers: ["mock", "devin"],
      runsPerProvider: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.totals.total).toBe(2);
    expect(r.totals.passed).toBe(1);
    expect(r.totals.skipped).toBe(1);
    // Aggregate=pass requires every run to pass.
    expect(r.aggregate_verdict).toBe("fail");
  });

  test("9-run cross-provider mock matrix (3 providers × 3 runs): all pass via mock", () => {
    // Simulates the parent task's Success criterion shape, but with
    // mock providers so CI can run it deterministically.
    const r = buildReport({
      providers: ["mock", "mock", "mock"],
      runsPerProvider: 3,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(r.runs).toHaveLength(9);
    expect(r.totals.passed).toBe(9);
    expect(r.aggregate_verdict).toBe("pass");
    expect(r.runs_passed).toBe(9);
  });

  test("report has stable JSON shape with all documented fields", () => {
    const r = buildReport({
      providers: ["mock"],
      runsPerProvider: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
      live: false,
    });
    expect(typeof r.timestamp).toBe("string");
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.config).toEqual({
      providers: ["mock"],
      runs_per_provider: 1,
      threshold_seconds: 90,
      threshold_prompts: 1,
      live: false,
    });
    expect(r.runs[0]).toMatchObject({
      provider: "mock",
      run_index: 1,
      duration_seconds: expect.any(Number),
      prompt_count: expect.any(Number),
      verdict: "pass",
    });
  });
});

describe("measure-agent-install.mjs — mockReading (deterministic)", () => {
  test("same (provider, runIndex) → same reading across calls", () => {
    const a = mockReading({
      provider: "mock",
      runIndex: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    const b = mockReading({
      provider: "mock",
      runIndex: 2,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(a.duration_seconds).toBe(b.duration_seconds);
    expect(a.prompt_count).toBe(b.prompt_count);
    expect(a.verdict).toBe(b.verdict);
  });

  test("different runIndex → different duration (proves non-constant) but always ≤ 90s default", () => {
    const a = mockReading({
      provider: "mock",
      runIndex: 1,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    const b = mockReading({
      provider: "mock",
      runIndex: 5,
      thresholdSeconds: 90,
      thresholdPrompts: 1,
    });
    expect(a.duration_seconds).not.toBe(b.duration_seconds);
    expect(a.duration_seconds).toBeLessThanOrEqual(90);
    expect(b.duration_seconds).toBeLessThanOrEqual(90);
  });
});

describe("measure-agent-install.mjs — CLI integration", () => {
  /**
   * @param {readonly string[]} args
   * @param {Record<string, unknown>} [opts]
   */
  function runCli(args, opts = {}) {
    return spawnSync("node", [HARNESS_PATH, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      ...opts,
    });
  }

  test("--providers=mock --runs-per-provider=3 --threshold-seconds=90 --threshold-prompts=1: exits 0 with aggregate pass", () => {
    const r = runCli([
      "--providers=mock",
      "--runs-per-provider=3",
      "--threshold-seconds=90",
      "--threshold-prompts=1",
    ]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.aggregate_verdict).toBe("pass");
    expect(report.runs_passed).toBe(3);
  });

  test("invalid provider name: exits 2 with helpful error", () => {
    const r = runCli(["--providers=unknown-provider", "--runs-per-provider=1"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown provider");
  });

  test("--runs-per-provider=0: exits 2 (must be positive integer)", () => {
    const r = runCli(["--providers=mock", "--runs-per-provider=0"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--runs-per-provider");
  });

  test("--out=<file> writes the report JSON to the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "measure-agent-test-"));
    try {
      const outFile = join(dir, "report.json");
      const r = runCli([
        "--providers=mock",
        "--runs-per-provider=2",
        `--out=${outFile}`,
        "--quiet",
      ]);
      expect(r.status).toBe(0);
      expect(existsSync(outFile)).toBe(true);
      const report = JSON.parse(readFileSync(outFile, "utf8"));
      expect(report.aggregate_verdict).toBe("pass");
      expect(report.runs).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
